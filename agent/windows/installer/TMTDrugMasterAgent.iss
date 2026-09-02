; Inno Setup script for the TMT Drug Master Agent.
;
; Per-user install on purpose: the agent registers tmtagent:// under HKCU and
; stores its config under %LOCALAPPDATA% with DPAPI (current-user scope), so a
; machine-wide install would put the binary somewhere the running user cannot
; match. PrivilegesRequired=lowest also means staff at a รพ.สต. can install it
; without calling anyone for an admin password.
;
; AppVersion is passed in by build.ps1 (/DAppVersion=...) so version.py stays
; the single source of truth.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "TMT Drug Master Agent"
#define AppExeName "TMTDrugMasterAgent.exe"
#define AppPublisher "TMT Drug Master Platform"

[Setup]
AppId={{8E4C0A21-6B7D-4E63-9E4B-4A2E9C1F0D33}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\TMT Drug Master Agent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=TMTDrugMasterAgent-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExeName}
; Closing the tray app before overwriting its exe avoids a reboot-pending install.
CloseApplications=yes
CloseApplicationsFilter=*.exe
RestartApplications=no
SetupMutex=TMTDrugMasterAgentSetup

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startup"; Description: "เริ่มโปรแกรมอัตโนมัติเมื่อเข้าสู่ระบบ Windows"; GroupDescription: "ตัวเลือกการติดตั้ง"
Name: "desktopicon"; Description: "สร้างไอคอนบนเดสก์ท็อป"; GroupDescription: "ตัวเลือกการติดตั้ง"; Flags: unchecked

[Files]
Source: "..\dist\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; The agent re-registers this itself on every start; declaring it here as well
; is what makes uninstall remove it cleanly.
Root: HKA; Subkey: "Software\Classes\tmtagent"; ValueType: string; ValueName: ""; ValueData: "URL:TMT Drug Master Agent"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\tmtagent"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\tmtagent\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

; --startup keeps the app quiet when Windows launches it: no "already running"
; dialog, it just goes to the tray.
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "TMTDrugMasterAgent"; ValueData: """{app}\{#AppExeName}"" --startup"; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\{#AppExeName}"; Description: "เปิด {#AppName} ตอนนี้"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Logs only. The config holds the enrollment credential, so it is left in place
; for a reinstall; removing it is a deliberate act, not a side effect.
Type: files; Name: "{localappdata}\TMTDrugMasterAgent\agent.log*"
