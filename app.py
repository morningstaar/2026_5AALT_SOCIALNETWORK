import platform
import sys
import threading
from flask import Flask, render_template
from flask_socketio import SocketIO

# --- 1. DÉTECTION OS & PLUX ---
osDic = {
    "Darwin": f"MacOS/Intel{''.join(platform.python_version().split('.')[:2])}",
    "Linux": "Linux64",
    "Windows": f"Win{platform.architecture()[0][:2]}_{''.join(platform.python_version().split('.')[:2])}",
}

if platform.mac_ver()[0] != "":
    import subprocess
    from os import linesep
    p = subprocess.Popen("sw_vers", stdout=subprocess.PIPE)
    result = p.communicate()[0].decode("utf-8").split(str("\t"))[2].split(linesep)[0]
    if result.startswith("12."):
        print("macOS version is Monterrey!")
        osDic["Darwin"] = "MacOS/Intel310"
        if (int(platform.python_version().split(".")[0]) <= 3 and int(platform.python_version().split(".")[1]) < 10):
            print(f"Python version required is >= 3.10. Installed is {platform.python_version()}")
            exit()

sys.path.append(f"PLUX-API-Python3/{osDic[platform.system()]}")

try:
    import plux
except ImportError:
    print("❌ Erreur : API PLUX introuvable.")

# --- 2. CONFIGURATION WEB (FLASK) ---
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

class RealTimeDevice(plux.SignalsDev):
    def onRawFrame(self, nSeq, data):
        # Envoi des données 50Hz (toutes les 20 frames) pour la page web
        if nSeq % 20 == 0:
            socketio.emit('sensor_update', {
                'eda': data[0],
                'pzt': data[1],
                'ppg': data[2]
            })
        return False # Boucle infinie

def run_bitalino():
    address = "BTH98:D3:C1:FE:03:04" # Votre adresse
    try:
        device = RealTimeDevice(address)
        device.start(1000, [1, 2, 3, 4, 5, 6], 16)
        print(f"✅ BITalino connecté. Envoi web en cours...")
        device.loop()
    except Exception as e:
        print(f"❌ Erreur BITalino : {e}")

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == "__main__":
    sensor_thread = threading.Thread(target=run_bitalino)
    sensor_thread.daemon = True
    sensor_thread.start()
    
    print("🚀 Serveur Web lancé sur http://127.0.0.1:5000")
    socketio.run(app, port=5000, debug=False)