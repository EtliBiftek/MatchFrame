default rel
section .text

global mf_fast_abs_i32

; int32_t mf_fast_abs_i32(int32_t value)
; Windows x64 ABI: first integer argument in ECX, return in EAX.
mf_fast_abs_i32:
    mov eax, ecx
    cdq
    xor eax, edx
    sub eax, edx
    ret
