#include <windows.h>
// Isolated regression fixture: no GUI and no ready handshake, like the reported
// pre-window hang. Only used in artifacts/qa, never included in a release.
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int) { Sleep(INFINITE); return 0; }
