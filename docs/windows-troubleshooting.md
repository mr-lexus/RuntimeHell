# Windows Troubleshooting

## Defender / SmartScreen

Downloaded binaries may trigger SmartScreen. Click "More info" → "Run anyway".
Defender real-time scanning may slow first launch of large zips.

## Long paths

Enable long paths if workspace paths exceed 260 chars:
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
```

## WebKitRequirements DLLs

JSC analysis requires `bin64` DLLs from the WebKitRequirements support
artifact. RuntimeHell downloads and manages these automatically, scoping
them to the child process PATH only. If JSC fails to start, verify that
`%LOCALAPPDATA%\RuntimeHell\cache\support\webkit-requirements\bin64\` exists.

## taskkill permissions

Process tree cancellation uses `taskkill /pid <pid> /T /F`. This requires
sufficient privileges to kill the target process. In restricted environments,
contact your administrator.
