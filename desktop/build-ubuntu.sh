#!/usr/bin/env bash
# ============================================================
# TopCatSwap — gera o executável para Ubuntu (AppImage e .deb)
#
# Uso:  ./build-ubuntu.sh
# Resultado: pasta dist/ com TopCatSwap-1.1.2-x86_64.AppImage
#            e TopCatSwap-1.1.2-amd64.deb
# ============================================================

set -e

cd "$(dirname "$0")"

echo
echo "=== TopCatSwap: build para Ubuntu ==="
echo

# --- Node.js -------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    echo "ERRO: falta o Node.js (versão 18 ou superior)."
    echo "Instala-o e corre este script de novo."
    exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')

if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "ERRO: o Node.js $(node -v) é antigo; precisas da versão 18 ou superior."
    exit 1
fi

echo "Node.js $(node -v) · npm $(npm -v)"

# --- Pacotes do sistema (compilação dos módulos USB) ---------
MISSING=""

for pkg in build-essential libudev-dev libusb-1.0-0-dev python3; do
    dpkg -s "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done

if [ -n "$MISSING" ]; then
    echo
    echo "A instalar pacotes do sistema em falta:$MISSING"
    sudo apt-get update
    sudo apt-get install -y $MISSING
fi

# --- Dependências ---------------------------------------------
echo
echo "[1/4] A instalar as dependências (npm, inclui a biblioteca da Trezor)..."
npm install --no-audit --no-fund

echo
echo "[2/4] A autorizar e correr os scripts de instalação (Electron e módulos USB)..."
npm install-scripts approve electron node-hid usb keccak >/dev/null 2>&1 || true
npm rebuild electron node-hid usb keccak

echo
echo "[3/4] A compilar os módulos USB para o Electron..."
npx electron-builder install-app-deps

# --- Empacotamento --------------------------------------------
echo
echo "[4/4] A gerar o AppImage e o .deb..."
npx electron-builder --linux AppImage deb

echo
echo "=== Concluído ==="
ls -1 dist/*.AppImage dist/*.deb 2>/dev/null || true

# --- Avisos -----------------------------------------------------
if ! ls /etc/udev/rules.d/ 2>/dev/null | grep -qi -e ledger -e hw1; then
    echo
    echo "AVISO: não encontrei as regras udev da Ledger. Sem elas a app não vê a Ledger:"
    echo "  wget -q -O - https://raw.githubusercontent.com/LedgerHQ/udev-rules/master/add_udev_rules.sh | sudo bash"
fi

if ! ls /etc/udev/rules.d/ 2>/dev/null | grep -qi trezor; then
    echo
    echo "Nota: se fores usar uma Trezor, instala as regras udev dela (uma vez):"
    echo "  sudo curl -fsSL https://data.trezor.io/udev/51-trezor.rules -o /etc/udev/rules.d/51-trezor.rules"
    echo "  sudo udevadm control --reload-rules && sudo udevadm trigger"
fi

echo
echo "Para instalar:  sudo apt install ./dist/TopCatSwap-1.1.2-amd64.deb"
echo "Ou correr o AppImage:  chmod +x dist/TopCatSwap-1.1.2-x86_64.AppImage && ./dist/TopCatSwap-1.1.2-x86_64.AppImage --no-sandbox"
echo
