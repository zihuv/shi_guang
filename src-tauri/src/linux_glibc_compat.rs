use core::ffi::{c_char, c_int, c_long, c_longlong, c_ulong, c_ulonglong};

unsafe extern "C" {
    fn strtol(nptr: *const c_char, endptr: *mut *mut c_char, base: c_int) -> c_long;
    fn strtoll(nptr: *const c_char, endptr: *mut *mut c_char, base: c_int) -> c_longlong;
    fn strtoul(nptr: *const c_char, endptr: *mut *mut c_char, base: c_int) -> c_ulong;
    fn strtoull(nptr: *const c_char, endptr: *mut *mut c_char, base: c_int) -> c_ulonglong;
}

// The prebuilt ONNX Runtime archive pulled in by `ort` is currently built
// against glibc's C23 entry points. Ubuntu 22.04 ships glibc 2.35, so we
// provide symbol-compatible fallbacks that delegate to the classic functions.
#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtol(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_long {
    unsafe { strtol(nptr, endptr, base) }
}

#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoll(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_longlong {
    unsafe { strtoll(nptr, endptr, base) }
}

#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoul(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_ulong {
    unsafe { strtoul(nptr, endptr, base) }
}

#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoull(
    nptr: *const c_char,
    endptr: *mut *mut c_char,
    base: c_int,
) -> c_ulonglong {
    unsafe { strtoull(nptr, endptr, base) }
}
