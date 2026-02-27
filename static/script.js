const socket = io();


const edaDisplay = document.getElementById('eda-val');
const pztDisplay = document.getElementById('pzt-val');
const ppgDisplay = document.getElementById('ppg-val');
const bpmDisplay = document.getElementById('ppg-bpm'); 
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const videos = document.querySelectorAll('video');

const MAX_DATA_POINTS = 150; 


let isCalibrating = false, isRunning = false;
let calibEda = [], calibPzt = [], calibPpg = [];



let refEda = 0, refPzt = 0, refBpm = 70;
let prevPzt = 0; // Pour détecter le changement de pente respiratoire

let targetBlur = 0, currentVisualBlur = 0;


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

const edaChart = createChart('eda-chart', '#00ff88', 'EDA', 0, 2); 
const pztChart = createChart('pzt-chart', '#00d4ff', 'PZT', -100, 100);
const ppgChart = createChart('ppg-chart', '#ff007f', 'PPG', 0, 600);


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


socket.on('sensor_update', function(data) {
    
    // Phase 1: Calibration Initiale (Juste pour ne pas commencer à 0 brutalement)
    if (isCalibrating) {
        refEda = data.eda;
        refPzt = data.pzt; // On initialise la référence
        return; 
    }

    if (isRunning && edaDisplay) {
        calculateBPM(data.ppg);

        
        refEda = (refEda * 0.95) + (data.eda * 0.05);
      
        refPzt = (refPzt * 0.90) + (data.pzt * 0.10); 
        
        
        refBpm = (refBpm * 0.98) + (currentBPM * 0.02);

    
        let variationEda = data.eda - refEda;
        
     
        let deltaPzt = Math.abs(data.pzt - prevPzt);
        prevPzt = data.pzt;
        
     
        let variationBpm = currentBPM - refBpm;

        
        updateChartData(edaChart, variationEda);
        updateChartData(pztChart, data.pzt - refPzt); 
        updateChartData(ppgChart, data.ppg); 

        edaDisplay.innerText = Math.round(variationEda);
        pztDisplay.innerText = Math.round(data.pzt - refPzt);
        ppgDisplay.innerText = Math.round(data.ppg);

    
        
        
        let scoreEda = Math.abs(variationEda) * 2; 
        let scoreBpm = Math.abs(variationBpm) * 1.5;
        
       
        let scorePzt = 0;
        if (deltaPzt > 10) scorePzt = (deltaPzt - 10) * 0.5; 

   
        let scoreGlobal = scoreEda + scoreBpm + scorePzt;

        
        let smoothScore = stressChart.data.datasets[0].data[MAX_DATA_POINTS-1] || 0;
        smoothScore = (smoothScore * 0.8) + (scoreGlobal * 0.2);

        updateChartData(stressChart, smoothScore, 0); 
        updateChartData(stressChart, SEUIL_TOLERANCE, 1);

        
        if (smoothScore < SEUIL_TOLERANCE) {
            targetBlur = 0; // Stable = Net
        } else {
            
            targetBlur = (smoothScore - SEUIL_TOLERANCE) * 1.5; 
            if(targetBlur > 20) targetBlur = 20; // Max flou
        }
    }
});


startBtn.addEventListener('click', () => {
    startBtn.innerText = "INITIALISATION... (3s)";
    startBtn.style.backgroundColor = "#ffaa00";
    isCalibrating = true;

    setTimeout(() => {
        isCalibrating = false;
        isRunning = true;
        
       

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
    }, 3000);
});
