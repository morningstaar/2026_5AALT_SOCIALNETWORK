# Biofeedback Social Feed : Interface de Régulation Physiologique

Ce projet est un prototype de recherche explorant l'interaction entre la consommation de contenus numériques (type TikTok/Reels) et les **changements physiologiques** de l'utilisateur. En utilisant un capteur **BITalino**, le système ajuste la clarté visuelle du flux vidéo en temps réel selon le niveau d'activation du système nerveux autonome détecté.

##  Concept & Hypothèse
L'hypothèse centrale repose sur la **consommation numérique consciente**. Le système agit comme un miroir de l'état interne de l'utilisateur :
1. **Détection en temps réel** : Le système surveille en continu vos constantes biologiques (sudation de la peau, rythme cardiaque et respiration) pour détecter le moindre changement d'état interne.
2. **Censure Visuelle (Floutage)** : Si une forte excitation ou une agitation physiologique est détectée, la vidéo se floute instantanément. Ce mécanisme bloque l'accès au contenu dès que vous perdez votre calme.
3. **Régulation par Biofeedback** : Pour retrouver une image nette, vous devez apprendre à vous apaiser volontairement. Ce processus brise la consommation passive des réseaux sociaux en vous redonnant le contrôle sur vos émotions.

##  Architecture Technique
L'architecture est structurée en trois couches distinctes :

### A. Acquisition Matérielle (BITalino)
* **Échantillonnage** : Numérisation des signaux à 1000 Hz sur 16 bits.
* **Signaux capturés** : 
    * **EDA** (Activité Électrodermale) : Mesure de la micro-sudation cutanée, indicateur de l'éveil émotionnel.
    * **PZT** (Piézoélectrique) : Monitoring de la sangle respiratoire.
    * **PPG** (Photopléthysmographie) : Capture de l'onde de pouls pour l'extraction de la fréquence cardiaque.

### B. Backend (Python & Flask)
* **API Plux** : Réception du flux haute fréquence dans un thread séparé pour garantir la réactivité du serveur.
* **Sous-échantillonnage** : Transmission des données au client web à 50 Hz via WebSockets (SocketIO). Cette fréquence permet de reconstruire l'onde de pouls avec précision tout en optimisant les ressources.

### C. Frontend (JavaScript & Web)
* **Monitoring** : Tracé des signaux en temps réel via Chart.js.
* **Traitement du Rythme Cardiaque** : Le BPM est calculé sur une moyenne glissante des 8 derniers battements pour stabiliser l'affichage.
* **Référence Glissante** : Un filtre passe-haut s'adapte en continu (adaptation en environ 3 secondes), permettant au score de revenir à zéro dès que l'état physiologique se stabilise.
* **Expérience Utilisateur** : Système de scroll imitant les réseaux sociaux avec "Scroll Snapping" et un "IntersectionObserver" pour n'activer que la vidéo centrale.

## Algorithme de Biofeedback
La variable pilote est l'**Indice d'Instabilité Globale** (courbe orange). 



Elle est calculée par la fusion des variations absolues (`Math.abs`) des trois paramètres :
- **Sous le seuil** : Vidéo nette (stabilité physiologique).
- **Au-dessus du seuil** : Application d'un flou progressif via CSS `filter: blur()` (activation physiologique élevée).


Pour lancer l'expérience et activer la boucle de biofeedback, suivez ces étapes :

1. **Lancement du serveur** : Exécutez le script principal via votre terminal : `python app.py`.
2. **Accès à l'interface** : Ouvrez votre navigateur et accédez à l'adresse locale : `http://127.0.0.1:5000`.
3. **Démarrage** : Cliquez sur le bouton **"Démarrer"** présent sur l'écran d'accueil.
4. **Calibration** : Restez immobile et calme pendant les **3 secondes de calibration initiale**. Cette étape est indispensable pour que l'algorithme calcule votre ligne de base physiologique.
5. **Navigation** : Une fois l'interface chargée, vous pouvez parcourir le flux vidéo. Le floutage réagira dynamiquement à vos changements d'état interne.

---

### Structure du Projet
* `app.py` : Serveur Flask et gestion du thread d'acquisition Bluetooth pour le BITalino.
* `static/script.js` : Algorithmes de traitement du signal, calcul du rythme cardiaque (BPM) et moteur de floutage.
* `static/style.css` : Mise en page au format "Smartphone" et gestion des effets visuels.
* `templates/index.html` : Structure de l'interface utilisateur et flux vidéo.
