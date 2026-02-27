const socket = io();

// Éléments HTML
const edaDisplay = document.getElementById('eda-val');
const pztDisplay = document.getElementById('pzt-val');
const ppgDisplay = document.getElementById('ppg-val');
const bpmDisplay = document.getElementById('ppg-bpm'); 
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const videos = document.querySelectorAll('video');

const MAX_DATA_POINTS = 150; 

// Variables d'état
let isCalibrating = false, isRunning = false;
let calibEda = [], calibPzt = [], calibPpg = [];

// --- NOUVEAU : RÉFÉRENCES DYNAMIQUES (Pour le suivi continu) ---
// Au lieu d'offsets fixes, ce sont des valeurs qui vont "poursuivre" le signal
let refEda = 0, refPzt = 0, refBpm = 70;
let prevPzt = 0; // Pour détecter le changement de pente respiratoire

let targetBlur = 0, currentVisualBlur = 0;

// --- OBSERVATEUR DE SCROLL (Façon TikTok/Insta) ---
const videoObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const video = entry.target;
        if (entry.isIntersecting) {
            if (isRunning) video.play();
        } else {
            video.pause();
            // video.currentTime = 0; // Décommentez si vous voulez reset la vidéo à chaque fois
        }
    });
}, { threshold: 0.6 });

videos.forEach(video => { videoObserver.observe(video); });

// --- 1. CONFIGURATION DES GRAPHIQUES ---
function createChart(ctxId, color, label, fixedMin, fixedMax) {
    const ctx = document.getElementById(ctxId).getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(MAX_DATA_POINTS).fill(''), 
            datasets: [{ data: Array(MAX_DATA_POINTS).fill(null), borderColor: color, borderWidth: 2, tension: 0.4, pointRadius: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: {
                x: { display: false },
                y: { display: true, suggestedMin: fixedMin, suggestedMax: fixedMax, grid: { color: 'rgba(255,255,255,0.2)' }, ticks: { color: color, font: { size: 10 }, maxTicksLimit: 5 } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

const edaChart = createChart('eda-chart', '#00ff88', 'EDA', 0, 2); // Zoomé sur la variation
const pztChart = createChart('pzt-chart', '#00d4ff', 'PZT', -100, 100);
const ppgChart = createChart('ppg-chart', '#ff007f', 'PPG', 0, 600);

// GRAPHIQUE ORANGE (Score de CHANGEMENT)
const SEUIL_TOLERANCE = 5; 
const ctxStress = document.getElementById('stress-chart').getContext('2d');
const stressChart = new Chart(ctxStress, {
    type: 'line',
    data: {
        labels: Array(MAX_DATA_POINTS).fill(''),
        datasets: [
            { label: 'Instabilité', data: Array(MAX_DATA_POINTS).fill(null), borderColor: '#ffaa00', borderWidth: 3, tension: 0.4, pointRadius: 0 },
            { label: 'Seuil', data: Array(MAX_DATA_POINTS).fill(SEUIL_TOLERANCE), borderColor: 'rgba(255, 0, 0, 0.6)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0 }
        ]
    },
    options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
            x: { display: false },
            y: { display: true, min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.2)' }, ticks: { color: '#ffaa00', font: { size: 10 }, stepSize: 25 } }
        },
        plugins: { legend: { display: false } }
    }
});

// --- 2. CALCUL DU BPM ---
let ppgBuffer = [];
let lastBeatTime = 0, currentBPM = 70;

function calculateBPM(newValue) {
    const now = Date.now();
    ppgBuffer.push({ value: newValue, time: now });
    if (ppgBuffer.length > 50) ppgBuffer.shift();

    if (ppgBuffer.length > 10) {
        let maxVal = -Infinity, minVal = Infinity, sum = 0;
        for (let i = 0; i < ppgBuffer.length; i++) {
            let v = ppgBuffer[i].value;
            sum += v; if (v > maxVal) maxVal = v; if (v < minVal) minVal = v;
        }
        let amplitude = maxVal - minVal;

        if (amplitude < 20) {
            bpmDisplay.innerText = "-- BPM";
            return; 
        }

        let avg = sum / ppgBuffer.length;
        let isPeak = newValue > (avg + (amplitude * 0.3)); 

        if (isPeak && (now - lastBeatTime > 400)) { // Limite physique > 400ms (150 BPM max)
            if (lastBeatTime !== 0) {
                let instantBPM = Math.round(60000 / (now - lastBeatTime));
                if (instantBPM > 40 && instantBPM < 160) {
                    currentBPM = instantBPM;
                    bpmDisplay.innerText = currentBPM + " BPM";
                }
            }
            lastBeatTime = now;
        }
    }
}

function updateChartData(chart, newValue, datasetIndex = 0) {
    const dataArray = chart.data.datasets[datasetIndex].data;
    dataArray.push(newValue);
    dataArray.shift();
    chart.update();
}

function smoothBlurLoop() {
    if (isRunning) {
        currentVisualBlur += (targetBlur - currentVisualBlur) * 0.05;
        videos.forEach(v => { 
            // On n'applique le flou que si la vidéo est visible pour économiser les ressources
            if(v.style.display !== 'none') {
                v.style.filter = `blur(${currentVisualBlur}px)`; 
            }
        });
    }
    requestAnimationFrame(smoothBlurLoop);
}
smoothBlurLoop();

// --- 3. RÉCEPTION EN TEMPS RÉEL (Cœur du Logiciel) ---
socket.on('sensor_update', function(data) {
    
    // Phase 1: Calibration Initiale (Juste pour ne pas commencer à 0 brutalement)
    if (isCalibrating) {
        refEda = data.eda;
        refPzt = data.pzt; // On initialise la référence
        return; 
    }

    if (isRunning && edaDisplay) {
        calculateBPM(data.ppg);

        // --- A. LOGIQUE DE "RÉFÉRENCE GLISSANTE" (LE SECRET) ---
        // C'est ici que la magie opère. La référence "poursuit" la valeur actuelle.
        // Si la valeur est stable, la référence la rattrape -> Différence = 0.
        // Si la valeur bouge vite, la référence traîne -> Différence = Grand.
        
        // Facteur d'adaptation : 0.05 (Rattrapage rapide en ~1-2 secondes)
        // Plus ce chiffre est grand, plus le retour à 0 est rapide.
        refEda = (refEda * 0.95) + (data.eda * 0.05);
        
        // Pour la respiration (PZT), c'est une onde, donc on track la "moyenne" (le centre de l'onde)
        refPzt = (refPzt * 0.90) + (data.pzt * 0.10); 
        
        // Pour le BPM, on track le BPM moyen récent
        refBpm = (refBpm * 0.98) + (currentBPM * 0.02);

        // --- B. CALCUL DE L'INSTABILITÉ (VARIATION) ---
        
        // 1. EDA : Simple écart par rapport à la moyenne récente
        // Si je stresse -> data.eda monte vite -> diffEda grandit
        // Si je reste stressé (plateau) -> refEda rattrape -> diffEda revient à 0
        let variationEda = data.eda - refEda;
        
        // 2. PZT : On veut savoir si le rythme change.
        // On regarde la "vitesse" de la respiration (Dérivée)
        let deltaPzt = Math.abs(data.pzt - prevPzt);
        prevPzt = data.pzt;
        
        // 3. BPM : Écart par rapport à la moyenne
        let variationBpm = currentBPM - refBpm;

        // Mise à jour des graphes individuels (centrés sur 0 grâce à la ref dynamique)
        updateChartData(edaChart, variationEda);
        updateChartData(pztChart, data.pzt - refPzt); // On affiche l'onde centrée
        updateChartData(ppgChart, data.ppg); // Le PPG brut est plus joli à voir

        edaDisplay.innerText = Math.round(variationEda);
        pztDisplay.innerText = Math.round(data.pzt - refPzt);
        ppgDisplay.innerText = Math.round(data.ppg);

        // --- C. CALCUL DU SCORE GLOBAL (ORANGE) ---
        
        // On prend la Valeur Absolue (Math.abs) car un changement vers le bas est aussi un changement !
        let scoreEda = Math.abs(variationEda) * 2; // EDA est très sensible
        let scoreBpm = Math.abs(variationBpm) * 1.5;
        
        // Pour la respiration, si on respire normalement, deltaPzt est constant.
        // Si on s'agite, deltaPzt augmente.
        // On normalise un peu (valeur empirique)
        let scorePzt = 0;
        if (deltaPzt > 10) scorePzt = (deltaPzt - 10) * 0.5; // Ignore les petites respirations calmes

        // Fusion des scores d'instabilité
        let scoreGlobal = scoreEda + scoreBpm + scorePzt;

        // Lissage du score orange pour éviter qu'il ne saute trop
        // On ne l'affiche pas brut, on fait une petite moyenne
        let smoothScore = stressChart.data.datasets[0].data[MAX_DATA_POINTS-1] || 0;
        smoothScore = (smoothScore * 0.8) + (scoreGlobal * 0.2);

        updateChartData(stressChart, smoothScore, 0); 
        updateChartData(stressChart, SEUIL_TOLERANCE, 1);

        // --- D. RÈGLE DE FLOU ---
        if (smoothScore < SEUIL_TOLERANCE) {
            targetBlur = 0; // Stable = Net
        } else {
            // Instable = Flou
            targetBlur = (smoothScore - SEUIL_TOLERANCE) * 1.5; 
            if(targetBlur > 20) targetBlur = 20; // Max flou
        }
    }
});

// --- 4. DÉMARRAGE ---
startBtn.addEventListener('click', () => {
    startBtn.innerText = "INITIALISATION... (3s)";
    startBtn.style.backgroundColor = "#ffaa00";
    isCalibrating = true;

    setTimeout(() => {
        isCalibrating = false;
        isRunning = true;
        
        // Initialisation des refs avec les valeurs actuelles pour éviter un saut au début
        // (Note: data n'est pas accessible ici, mais refEda sera mis à jour au premier passage de socket.on)

        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
            // On force la lecture de la vidéo visible
            videos.forEach(v => { 
                v.muted = false; 
                let rect = v.getBoundingClientRect();
                if(rect.top >= 0 && rect.bottom <= window.innerHeight) v.play();
            });
        }, 500);
    }, 3000); // 3 secondes suffisent maintenant
});