#include <cstdint>
#include <cstring>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <vector>
#include <string>

extern "C" int32_t mf_fast_abs_i32(int32_t value);

static DWORD find_cs2_pid() {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    DWORD result = 0;
    if (Process32FirstW(snapshot, &entry)) {
        do {
            if (_wcsicmp(entry.szExeFile, L"cs2.exe") == 0) { result = entry.th32ProcessID; break; }
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return result;
}

struct WindowSearch { DWORD pid; HWND window; };
static BOOL CALLBACK enum_windows(HWND hwnd, LPARAM param) {
    auto* search = reinterpret_cast<WindowSearch*>(param);
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == search->pid && IsWindowVisible(hwnd) && GetWindow(hwnd, GW_OWNER) == nullptr) {
        search->window = hwnd;
        return FALSE;
    }
    return TRUE;
}

static void key_press(WORD vk) {
    INPUT input[2]{};
    input[0].type = INPUT_KEYBOARD; input[0].ki.wVk = vk;
    input[1].type = INPUT_KEYBOARD; input[1].ki.wVk = vk; input[1].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(2, input, sizeof(INPUT));
}

static void type_unicode(const std::wstring& text) {
    std::vector<INPUT> events;
    events.reserve(text.size() * 2);
    for (wchar_t ch : text) {
        INPUT down{}; down.type = INPUT_KEYBOARD; down.ki.wScan = ch; down.ki.dwFlags = KEYEVENTF_UNICODE;
        INPUT up = down; up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        events.push_back(down); events.push_back(up);
    }
    if (!events.empty()) SendInput(static_cast<UINT>(events.size()), events.data(), sizeof(INPUT));
}

extern "C" int32_t mf_cs2_running() { return find_cs2_pid() ? 1 : 0; }

extern "C" int32_t mf_send_console_command(const char* utf8, size_t length) {
    if (!utf8 || length == 0 || length > 512) return -1;
    for (size_t i = 0; i < length; ++i) if (utf8[i] == '\n' || utf8[i] == '\r') return -2;
    DWORD pid = find_cs2_pid();
    if (!pid) return -3;
    WindowSearch search{pid, nullptr};
    EnumWindows(enum_windows, reinterpret_cast<LPARAM>(&search));
    if (!search.window) return -4;

    int needed = MultiByteToWideChar(CP_UTF8, 0, utf8, static_cast<int>(length), nullptr, 0);
    if (needed <= 0) return -5;
    std::wstring wide(static_cast<size_t>(needed), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8, static_cast<int>(length), wide.data(), needed);

    HWND previous = GetForegroundWindow();
    ShowWindow(search.window, SW_RESTORE);
    SetForegroundWindow(search.window);
    Sleep(70);
    key_press(VK_OEM_3);
    Sleep(80);
    type_unicode(wide);
    key_press(VK_RETURN);
    Sleep(50);
    key_press(VK_OEM_3);
    Sleep(45);
    if (previous && previous != search.window && IsWindow(previous)) SetForegroundWindow(previous);
    return 0;
}

extern "C" int32_t mf_native_abs_probe(int32_t value) { return mf_fast_abs_i32(value); }
extern "C" const char* mf_native_version() { return "cpp-win32+asm-v2"; }
#else
extern "C" int32_t mf_cs2_running() { return 0; }
extern "C" int32_t mf_send_console_command(const char*, size_t) { return -100; }
extern "C" int32_t mf_native_abs_probe(int32_t value) { return value < 0 ? -value : value; }
extern "C" const char* mf_native_version() { return "cpp-portable-v2"; }
#endif
