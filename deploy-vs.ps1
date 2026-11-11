# deploy.ps1 — run from Windows to deploy sev7en VS to VPS 103.147.32.29
param([string]$AdminPass = "sev7en-admin")
$ErrorActionPreference = "Stop"
$keyLocal = "E:\Dev\.keys\omni"   # key without apostrophe
# if key not found, copy from home
if (!(Test-Path $keyLocal)) {
  Copy-Item "$env:USERPROFILE\.ssh\id_ed25519_omni_transfer" $keyLocal -Force
}
# Use WSL or Git-Bash scp via python's paramiko fallback if needed
# Simple: use scp from git-bash with MSYS path conversion disabled
$env:MSYS_NO_PATHCONV=1
$bash = "C:\Users\jars's\AppData\Local\hermes\tools\git-2.53.0+3-win32-x64\usr\bin\bash.exe"
& $bash -c "scp -i E:/Dev/.keys/omni -P 20301 -o StrictHostKeyChecking=no 'E:/Dev/Projek B Inggris/star_pou_vs.html' root@103.147.32.29:/tmp/star_pou_vs.html && ssh -i E:/Dev/.keys/omni -p 20301 -o StrictHostKeyChecking=no root@103.147.32.29 'ls -lh /tmp/star_pou_vs.html'"
