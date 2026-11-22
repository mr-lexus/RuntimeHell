# Windows Troubleshooting

## Defender / SmartScreen

Downloaded binaries may trigger SmartScreen. Click "More info" → "Run anyway".
Defender real-time scanning may slow first launch of large zips.

## Long paths

Enable long paths if workspace paths exceed 260 chars:
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
```

## JavaScriptCore DLLs

Current managed Windows installs place `jsc.exe`, `JavaScriptCore.dll`, ICU
and the required runtime DLLs together. If a managed shell reports a missing
DLL, reinstall JavaScriptCore from the Runtimes panel. Older or locally
imported builds may require their matching WebKitRequirements package.

## taskkill permissions

Process tree cancellation uses `taskkill /pid <pid> /T /F`. This requires
sufficient privileges to kill the target process. In restricted environments,
contact your administrator.
