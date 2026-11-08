# Creates (or refreshes) the HENSHIN shortcut on the Desktop. Re-run after moving the project folder.
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desk 'Henshin.lnk'))
$lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\start.ps1`""
$lnk.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$lnk.IconLocation = "$PSScriptRoot\henshin.ico,0"
$lnk.Description = 'HENSHIN - webcam AR transformation'
$lnk.WindowStyle = 7
$lnk.Save()
"shortcut: $(Join-Path $desk 'Henshin.lnk')"
