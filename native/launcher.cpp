// Ordinary Win32 launcher/updater. Static CRT; no elevation, scripts or services.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wincrypt.h>
#include <bcrypt.h>
#include <string>
#include <vector>
#include <set>
#include <fstream>
#include <sstream>
#include <filesystem>
#include <algorithm>
#include <stdexcept>
#pragma comment(lib,"user32.lib")
#pragma comment(lib,"gdi32.lib")
#pragma comment(lib,"shell32.lib")
#pragma comment(lib,"ole32.lib")
#pragma comment(lib,"crypt32.lib")
#pragma comment(lib,"bcrypt.lib")
namespace f = std::filesystem;
const std::wstring releases=L"https://github.com/Dunnnwei/123TokenBalance/releases/latest";
HWND windowHandle=nullptr, textHandle=nullptr;
std::wstring screenText, logPath;
bool headless=false;
std::string utf8(const std::wstring& s){if(s.empty())return {};int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string r(n,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),r.data(),n,nullptr,nullptr);return r;}
std::wstring wide(const std::string& s){if(s.empty())return {};int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0);if(!n)throw std::runtime_error("Invalid UTF-8");std::wstring r(n,0);MultiByteToWideChar(CP_UTF8,0,s.data(),(int)s.size(),r.data(),n);return r;}
std::wstring stamp(){SYSTEMTIME t;GetLocalTime(&t);wchar_t b[80];swprintf_s(b,L"%04d%02d%02d-%02d%02d%02d-%lu",t.wYear,t.wMonth,t.wDay,t.wHour,t.wMinute,t.wSecond,GetCurrentProcessId());return b;}
std::wstring localBase(){PWSTR p=nullptr;if(FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData,0,nullptr,&p)))throw std::runtime_error("LocalAppData unavailable");std::wstring r=p;CoTaskMemFree(p);return r+L"\\123TokenBalance";}
std::wstring exePath(){wchar_t p[32768];DWORD n=GetModuleFileNameW(nullptr,p,32768);if(!n||n>=32768)throw std::runtime_error("Executable path unavailable");return p;}
void pump(){MSG m;while(PeekMessageW(&m,nullptr,0,0,PM_REMOVE)){TranslateMessage(&m);DispatchMessageW(&m);}}
void line(const std::wstring& s){screenText+=s+L"\r\n";if(textHandle)SetWindowTextW(textHandle,screenText.c_str());pump();}
void record(const std::wstring& status,const std::wstring& id,const std::wstring& label,const std::wstring& detail,const std::wstring& url=L""){
  line((status==L"pass"?L"[通过] ":status==L"warn"?L"[提示] ":L"[未满足] ")+label+L"："+detail);
  if(!logPath.empty()){std::ofstream o(f::path(logPath),std::ios::app|std::ios::binary);o<<utf8(status+L"\t"+id+L"\t"+label+L"\t"+detail+L"\t"+url)<<"\n";}
}
LRESULT CALLBACK proc(HWND h,UINT m,WPARAM w,LPARAM l){
  if(m==WM_COMMAND){if(LOWORD(w)==1)ShellExecuteW(h,L"open",releases.c_str(),nullptr,nullptr,SW_SHOWNORMAL);if(LOWORD(w)==2&&!logPath.empty())ShellExecuteW(h,L"open",logPath.c_str(),nullptr,nullptr,SW_SHOWNORMAL);if(LOWORD(w)==3)DestroyWindow(h);return 0;}
  if(m==WM_DESTROY){windowHandle=nullptr;textHandle=nullptr;return 0;}return DefWindowProcW(h,m,w,l);
}
void show(){if(headless)return;WNDCLASSW c{};c.lpfnWndProc=proc;c.hInstance=GetModuleHandleW(nullptr);c.lpszClassName=L"TokenBalanceStartup";c.hCursor=LoadCursor(nullptr,IDC_ARROW);c.hbrBackground=(HBRUSH)(COLOR_WINDOW+1);c.hIcon=LoadIconW(c.hInstance,MAKEINTRESOURCEW(1));RegisterClassW(&c);
  windowHandle=CreateWindowW(c.lpszClassName,L"123 Token Balance · 启动环境检测",WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX,CW_USEDEFAULT,CW_USEDEFAULT,740,450,nullptr,nullptr,c.hInstance,nullptr);
  textHandle=CreateWindowW(L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_VSCROLL|ES_MULTILINE|ES_READONLY,18,18,690,320,windowHandle,nullptr,c.hInstance,nullptr);
  SendMessageW(textHandle,WM_SETFONT,(WPARAM)GetStockObject(DEFAULT_GUI_FONT),TRUE);
  const wchar_t* labels[]={L"下载完整发布包",L"查看检测日志",L"关闭"};for(int i=0;i<3;i++){HWND b=CreateWindowW(L"BUTTON",labels[i],WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON,18+i*225,355,210,32,windowHandle,(HMENU)(INT_PTR)(i+1),c.hInstance,nullptr);SendMessageW(b,WM_SETFONT,(WPARAM)GetStockObject(DEFAULT_GUI_FONT),TRUE);}
  ShowWindow(windowHandle,SW_SHOW);UpdateWindow(windowHandle);line(L"正在检查本地环境，请稍候…");
}
int finishError(const std::wstring& s){record(L"fail",L"startup",L"启动未完成",s,releases);line(L"请查看检测日志，或从 GitHub 下载完整 ZIP 后解压到可写文件夹。");while(windowHandle){pump();Sleep(40);}return 1;}
bool file(const f::path& p){std::error_code e;return f::is_regular_file(p,e);}
bool writable(const f::path& p){try{f::create_directories(p);f::path q=p/(L".write-probe-"+stamp());HANDLE h=CreateFileW(q.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_TEMPORARY|FILE_FLAG_DELETE_ON_CLOSE,nullptr);if(h==INVALID_HANDLE_VALUE)return false;CloseHandle(h);return true;}catch(...){return false;}}
std::string read(const f::path& p,size_t limit=1024*1024){if(f::file_size(p)>limit)throw std::runtime_error("File exceeds limit");std::ifstream s(p,std::ios::binary);return {std::istreambuf_iterator<char>(s),{}};}
std::string sha(const f::path& p){BCRYPT_ALG_HANDLE a=nullptr;BCRYPT_HASH_HANDLE h=nullptr;if(BCryptOpenAlgorithmProvider(&a,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)throw std::runtime_error("SHA-256 unavailable");if(BCryptCreateHash(a,&h,nullptr,0,nullptr,0,0)<0){BCryptCloseAlgorithmProvider(a,0);throw std::runtime_error("SHA-256 init failed");}std::ifstream in(p,std::ios::binary);char buf[65536];bool good=!!in;while(in){in.read(buf,sizeof(buf));auto n=in.gcount();if(n&&BCryptHashData(h,(PUCHAR)buf,(ULONG)n,0)<0){good=false;break;}}unsigned char d[32];if(in.bad()||BCryptFinishHash(h,d,32,0)<0)good=false;BCryptDestroyHash(h);BCryptCloseAlgorithmProvider(a,0);if(!good)throw std::runtime_error("SHA-256 read failed");std::string r;const char* hex="0123456789abcdef";for(auto x:d){r+=hex[x>>4];r+=hex[x&15];}return r;}
std::wstring quote(const std::wstring& s){std::wstring r=L"\"";size_t slash=0;for(wchar_t c:s){if(c==L'\\'){slash++;continue;}if(c==L'"'){r.append(slash*2+1,L'\\');r+=c;}else{r.append(slash,L'\\');r+=c;}slash=0;}r.append(slash*2,L'\\');return r+L"\"";}
PROCESS_INFORMATION launch(const f::path& exe,const std::vector<std::wstring>& args){std::wstring cmd=quote(exe.wstring());for(auto& a:args)cmd+=L" "+quote(a);STARTUPINFOW si{};si.cb=sizeof(si);PROCESS_INFORMATION pi{};if(!CreateProcessW(exe.c_str(),cmd.data(),nullptr,nullptr,FALSE,0,nullptr,exe.parent_path().c_str(),&si,&pi))throw std::runtime_error("CreateProcess error "+std::to_string(GetLastError()));CloseHandle(pi.hThread);return pi;}
bool safeRelative(const std::wstring& s){if(s.empty()||s.front()==L'/'||s.front()==L'\\'||s.find_first_of(L":\\\t\r\n")!=std::wstring::npos)return false;f::path p(s);for(auto& part:p){std::wstring v=part.wstring();if(v==L"."||v==L".."||v.empty()||v.back()==L'.'||v.back()==L' ')return false;std::wstring lower=v;std::transform(lower.begin(),lower.end(),lower.begin(),towlower);if(lower==L"data"||lower==L".git"||lower==L"node_modules")return false;}return true;}
bool noLinks(f::path p){for(;!p.empty();){DWORD a=GetFileAttributesW(p.c_str());if(a!=INVALID_FILE_ATTRIBUTES&&(a&FILE_ATTRIBUTE_REPARSE_POINT))return false;auto parent=p.parent_path();if(parent==p)break;p=parent;}return true;}
bool runtimeFiles(const f::path& root){const wchar_t* required[]={L"123TokenBalance.App.exe",L"resources\\app.asar",L"icudtl.dat",L"ffmpeg.dll",L"resources.pak",L"v8_context_snapshot.bin",L"locales\\zh-CN.pak",L"runtime-files.txt"};for(auto n:required)if(!file(root/n)){record(L"fail",L"runtime",L"程序文件完整性",L"缺少 "+std::wstring(n),releases);return false;}
  std::istringstream s(read(root/L"runtime-files.txt"));std::string row;size_t count=0;while(std::getline(s,row)){if(!row.empty()&&row.back()=='\r')row.pop_back();auto at=row.find('\t');if(at==std::string::npos)throw std::runtime_error("Invalid runtime manifest");auto relative=wide(row.substr(at+1));if(!safeRelative(relative))throw std::runtime_error("Invalid runtime path");auto p=root/relative;if(!file(p)||f::file_size(p)!=std::stoull(row.substr(0,at))){record(L"fail",L"runtime",L"程序文件完整性",L"缺失或尺寸不符："+relative,releases);return false;}count++;}if(count<10)throw std::runtime_error("Incomplete runtime manifest");record(L"pass",L"runtime",L"程序文件完整性",L"已快速核对 "+std::to_wstring(count)+L" 个运行文件；内置 Chromium / Node");return true;
}
void browserKey(const f::path& data){auto localState=data/L"runtime"/L"Local State";if(!file(localState))return;std::string content=read(localState,16*1024*1024);auto at=content.find("\"encrypted_key\"");if(at==std::string::npos)return;at=content.find(':',at);if(at==std::string::npos)return;auto start=content.find('"',at),end=content.find('"',start+1);if(start==std::string::npos||end==std::string::npos)throw std::runtime_error("Invalid browser key");std::string b64=content.substr(start+1,end-start-1);DWORD n=0;bool valid=false;
  if(CryptStringToBinaryA(b64.c_str(),0,CRYPT_STRING_BASE64,nullptr,&n,nullptr,nullptr)&&n>5){std::vector<BYTE> bytes(n);CryptStringToBinaryA(b64.c_str(),0,CRYPT_STRING_BASE64,bytes.data(),&n,nullptr,nullptr);if(memcmp(bytes.data(),"DPAPI",5)==0){DATA_BLOB input{n-5,bytes.data()+5},output{};valid=!!CryptUnprotectData(&input,nullptr,nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&output);if(output.pbData){SecureZeroMemory(output.pbData,output.cbData);LocalFree(output.pbData);}}}
  if(valid){record(L"pass",L"profile",L"本机加密配置",L"原浏览器密钥可用，保留账号解密环境");return;}
  auto archive=data/(L"runtime-unreadable-"+stamp());f::rename(data/L"runtime",archive);record(L"warn",L"profile",L"跨机浏览器配置",L"旧浏览器配置已完整另存。请重新登录网页；原账号文件保留，可从口令备份恢复。");
}
bool verifyStage(const f::path& root,const std::string& expected){if(sha(root/L"SHA256SUMS.txt")!=expected)return false;std::set<std::wstring> listed;std::istringstream s(read(root/L"SHA256SUMS.txt",4*1024*1024));std::string row;while(std::getline(s,row)){if(!row.empty()&&row.back()=='\r')row.pop_back();if(row.size()<67||row.substr(64,2)!="  ")return false;auto rel=wide(row.substr(66));if(!safeRelative(rel))return false;std::wstring key=rel;std::transform(key.begin(),key.end(),key.begin(),towlower);if(!listed.insert(key).second||!noLinks(root/rel)||!file(root/rel)||sha(root/rel)!=row.substr(0,64))return false;}
  size_t actual=0;for(auto& entry:f::recursive_directory_iterator(root)){if(!noLinks(entry.path()))return false;if(entry.is_regular_file()){auto rel=f::relative(entry.path(),root).generic_wstring();std::transform(rel.begin(),rel.end(),rel.begin(),towlower);if(rel==L"sha256sums.txt")continue;if(!listed.count(rel))return false;actual++;}}
  return actual==listed.size()&&actual>=15&&file(root/L"123TokenBalance.exe")&&file(root/L"123TokenBalance.App.exe")&&file(root/L"resources"/L"app.asar")&&file(root/L"VERSION.txt");
}
bool moveRetry(const f::path& a,const f::path& b){for(int i=0;i<100;i++){if(MoveFileExW(a.c_str(),b.c_str(),MOVEFILE_WRITE_THROUGH))return true;Sleep(100);pump();}return false;}
int applyUpdate(const std::vector<std::wstring>& a){
  // Args: mode, existing application root, verified sibling stage, old PID,
  // data directory, SHA-256 of the full staged file manifest.
  if(a.size()!=6)return finishError(L"更新参数不完整。旧程序未修改。");
  f::path target=f::absolute(a[1]).lexically_normal(),stage=f::absolute(a[2]).lexically_normal(),data=f::absolute(a[4]).lexically_normal();
  std::string manifest= utf8(a[5]);
  if(target==target.root_path()||target.wstring().rfind(L"\\\\",0)==0||stage.parent_path()!=target.parent_path()||stage.filename().wstring().rfind(L".123TokenBalance-update-",0)!=0||target==stage||!noLinks(target)||!noLinks(stage)||!noLinks(data)||manifest.size()!=64||manifest.find_first_not_of("0123456789abcdef")!=std::string::npos||!file(target/L"123TokenBalance.App.exe")||!file(target/L"resources"/L"app.asar"))return finishError(L"更新目录验证失败。旧程序未修改。");
  auto relative=data.lexically_relative(target);if(!relative.empty()&&*relative.begin()!=L".."&&relative!=L"data")return finishError(L"自定义数据目录位于程序内部，请使用手动更新。");
  line(L"正在校验新版本完整文件；旧版本将保留为备份…");if(!verifyStage(stage,manifest))return finishError(L"更新文件校验失败。旧程序未修改。");
  DWORD pid=(DWORD)std::stoul(a[3]);HANDLE old=OpenProcess(SYNCHRONIZE,FALSE,pid);if(old){DWORD waited=WaitForSingleObject(old,30000);CloseHandle(old);if(waited!=WAIT_OBJECT_0)return finishError(L"旧程序尚未退出，请关闭后重试。未强制结束任何进程。");}
  f::path backup=target.wstring()+L".backup-"+stamp(),failed=target.wstring()+L".failed-"+stamp();
  if(!moveRetry(target,backup))return finishError(L"原文件夹仍被占用或没有写入权限。旧程序保留，请关闭其他副本后重试。");
  if(!moveRetry(stage,target)){moveRetry(backup,target);return finishError(L"无法切换新版本，已尝试恢复原文件夹。备份位置："+backup.wstring());}
  bool movedData=false;bool success=false;
  try{
    if(f::exists(backup/L"data")){if(!moveRetry(backup/L"data",target/L"data"))throw std::runtime_error("Cannot preserve data");movedData=true;}
    auto next=launch(target/L"123TokenBalance.exe",{L"--data-dir="+data.wstring(),L"--update-healthcheck"});
    DWORD wait=WAIT_TIMEOUT;for(int i=0;i<700&&wait==WAIT_TIMEOUT;i++){wait=WaitForSingleObject(next.hProcess,100);pump();}
    DWORD code=1;if(wait==WAIT_OBJECT_0)GetExitCodeProcess(next.hProcess,&code);CloseHandle(next.hProcess);
    if(wait!=WAIT_OBJECT_0)throw std::runtime_error("Launcher still active; manual recovery required");success=code==0;
  }catch(const std::exception& e){record(L"fail",L"update",L"更新启动",wide(e.what()));}
  if(success){record(L"pass",L"update",L"更新完成",L"原版本保留在："+backup.wstring());return 0;}
  // Rename, never delete, both program versions. Never discard the user's data.
  if(movedData&&f::exists(target/L"data")){if(!moveRetry(target/L"data",backup/L"data"))return finishError(L"数据仍被占用，未继续回滚。两份程序均保留。备份："+backup.wstring());}
  if(!moveRetry(target,failed)){if(movedData)moveRetry(backup/L"data",target/L"data");return finishError(L"新程序仍被占用，已保留原版备份："+backup.wstring());}
  if(!moveRetry(backup,target))return finishError(L"自动回滚未完成。请从备份目录启动："+backup.wstring());
  record(L"warn",L"rollback",L"已回滚",L"新版本未通过启动检查，原程序与数据已恢复。失败包："+failed.wstring());
  try{auto prior=launch(target/L"123TokenBalance.exe",{L"--data-dir="+data.wstring()});CloseHandle(prior.hProcess);}catch(...){}
  return finishError(L"新版本启动失败，已恢复原版本。请使用日志反馈问题。");
}
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){
  int argc=0;LPWSTR* argv=CommandLineToArgvW(GetCommandLineW(),&argc);std::vector<std::wstring> args;for(int i=1;i<argc;i++)args.emplace_back(argv[i]);LocalFree(argv);
  std::wstring reportOverride;bool diagnose=false,health=false;for(auto& a:args){if(a.rfind(L"--diagnose-output=",0)==0){headless=true;diagnose=true;reportOverride=a.substr(18);}if(a==L"--diagnose")diagnose=true;if(a==L"--update-healthcheck"){health=true;headless=true;}}
  try{
    auto logs=f::path(localBase())/L"logs";f::create_directories(logs);logPath=reportOverride.empty()?(logs/(L"startup-"+stamp()+L".tsv")).wstring():reportOverride;
    std::ofstream(logPath,std::ios::binary).close();show();
    if(!args.empty()&&args[0]==L"--apply-update")return applyUpdate(args);
    auto root=f::path(exePath()).parent_path();
    using RtlGetVersionFn=LONG(WINAPI*)(OSVERSIONINFOW*);auto rtl=(RtlGetVersionFn)GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"RtlGetVersion");OSVERSIONINFOW os{};os.dwOSVersionInfoSize=sizeof(os);if(!rtl||rtl(&os)!=0||os.dwMajorVersion<10||os.dwBuildNumber<19041)return finishError(L"需要 Windows 10 2004（build 19041）或更新的 64 位系统，推荐 Windows 11。https://www.microsoft.com/software-download/windows11");
    SYSTEM_INFO si;GetNativeSystemInfo(&si);if(si.wProcessorArchitecture!=PROCESSOR_ARCHITECTURE_AMD64&&si.wProcessorArchitecture!=PROCESSOR_ARCHITECTURE_ARM64)return finishError(L"本包需要 Windows x64，ARM64 需系统 x64 模拟支持。");
    record(L"pass",L"os",L"操作系统",L"Windows build "+std::to_wstring(os.dwBuildNumber)+(si.wProcessorArchitecture==PROCESSOR_ARCHITECTURE_ARM64?L" · ARM64 / x64 模拟":L" · x64"),L"https://www.microsoft.com/software-download/windows11");
    if(!runtimeFiles(root))return finishError(L"发布目录不完整或文件损坏，不能启动主体。请完整解压 ZIP，勿只拷贝 EXE。");
    f::path data=root/L"data";bool explicitData=false;for(auto& a:args)if(a.rfind(L"--data-dir=",0)==0){data=f::absolute(a.substr(11));explicitData=true;}
    if(!writable(data)){if(explicitData)return finishError(L"指定数据目录不可写："+data.wstring());auto key=std::hash<std::wstring>{}(root.wstring());data=f::path(localBase())/(L"portable-"+std::to_wstring(key));if(!writable(data))return finishError(L"程序目录与用户数据目录均不可写。");record(L"warn",L"data",L"数据目录",L"已使用当前用户目录："+data.wstring());}else record(L"pass",L"data",L"数据目录",data.wstring());
    browserKey(data);
    wchar_t system[32768];GetSystemDirectoryW(system,32768);bool media=file(f::path(system)/L"MFPlat.dll");record(media?L"pass":L"warn",L"media",L"Windows 媒体组件",media?L"已安装":L"Windows N/KN 可安装 Media Feature Pack；不阻止额度工作台启动",L"https://support.microsoft.com/windows/media-feature-pack-for-windows-n-8622b390-4ce6-43c9-9b42-549e5328e407");
    record(L"pass",L"runtime-deps",L"运行环境",L"内置运行时，无需安装 Node、Python、.NET、WebView2 或 VC 运行库");
    if(diagnose){line(L"环境检测完成。报告已保存。");while(windowHandle){pump();Sleep(40);}return 0;}
    auto ready=logs/(L"startup-"+stamp()+L".ready");std::error_code ignored;f::remove(ready,ignored);
    std::vector<std::wstring> forwarded;for(auto& a:args)if(a.rfind(L"--data-dir=",0)!=0&&a.rfind(L"--startup-",0)!=0&&a!=L"--update-healthcheck")forwarded.push_back(a);
    forwarded.push_back(L"--data-dir="+data.wstring());forwarded.push_back(L"--startup-report="+logPath);forwarded.push_back(L"--startup-ready="+ready.wstring());
    if(health)forwarded.push_back(L"--update-healthcheck");
    // A developer shell can inherit this flag; never let it turn the GUI into Node.
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE",nullptr);
    line(L"环境检测完成，正在打开工作台（最长等待 45 秒）…");auto pi=launch(root/L"123TokenBalance.App.exe",forwarded);DWORD exitCode=STILL_ACTIVE;
    ULONGLONG start=GetTickCount64();while(GetTickCount64()-start<45000){pump();if(file(ready)){f::remove(ready,ignored);CloseHandle(pi.hProcess);return 0;}GetExitCodeProcess(pi.hProcess,&exitCode);if(exitCode!=STILL_ACTIVE)break;Sleep(50);}
    if(exitCode==STILL_ACTIVE){ // Only the child process started by this launcher is asked to close.
      EnumWindows([](HWND h,LPARAM p)->BOOL{DWORD id;GetWindowThreadProcessId(h,&id);if(id==(DWORD)p)PostMessageW(h,WM_CLOSE,0,0);return TRUE;},pi.dwProcessId);
      WaitForSingleObject(pi.hProcess,5000);
    }
    CloseHandle(pi.hProcess);return finishError(L"主体未完成启动。进程退出码："+std::to_wstring(exitCode)+L"。请查看 data/logs/startup.log 和此检测报告；可能为系统策略拦截、文件损坏或渲染进程异常。");
  }catch(const std::exception& e){if(!headless&&!windowHandle)show();return finishError(L"启动异常："+wide(e.what()));}catch(...){if(!headless&&!windowHandle)show();return finishError(L"启动时发生未识别异常。");}
}
