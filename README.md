# Droido-Player
NFC Jukebox on android

## Setup
1. **Install Apps**
    1. **Termux**
        1. Go to https://f-droid.org/en/packages/com.termux/
        2. Scroll to the bottom of the info about the latest version (past the "Download F-Droid" button)
        3. Click "Download APK"
        4. Check your notifications for the download. When it finishes, click it and install
    2. **Termux:API**
        1. Go to https://f-droid.org/en/packages/com.termux.api/
        2. Scroll to the bottom of the info about the latest version (past the "Download F-Droid" button)
        3. Click "Download APK"
        4. Check your notifications for the download. When it finishes, click it and install
    3. **Automate** by LlamaLab from the play store
2. **Configure Apps**
    1. **Settings App**
    2. **Termux:API**
       1. Open the app
       2. Use the buttons to change settings for "battery optimizations" and "display over other apps"
    3. **Termux** Run the following and approve anything it asks. It will take a minute.
        ```bash
        pkg install git; \
        git clone https://github.com/BE-Code/Droido-Player.git; \
        cd Droido-Player; \
        ./setup
        ```
    4. **Automate**
