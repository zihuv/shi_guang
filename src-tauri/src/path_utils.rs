use std::path::Path;

pub(crate) fn normalize_path(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}

pub(crate) fn join_path(base: &str, child: impl AsRef<Path>) -> String {
    normalize_path(Path::new(base).join(child))
}

pub(crate) fn path_has_prefix(path: &str, prefix: &str) -> bool {
    let path = Path::new(path);
    let prefix = Path::new(prefix);
    path == prefix || path.starts_with(prefix)
}

pub(crate) fn replace_path_prefix(
    path: &str,
    old_prefix: &str,
    new_prefix: &str,
) -> Option<String> {
    let relative = Path::new(path).strip_prefix(Path::new(old_prefix)).ok()?;
    if relative.as_os_str().is_empty() {
        Some(normalize_path(new_prefix))
    } else {
        Some(normalize_path(Path::new(new_prefix).join(relative)))
    }
}

#[cfg(test)]
mod tests {
    use super::{join_path, path_has_prefix, replace_path_prefix};

    #[test]
    fn path_prefix_handles_nested_paths() {
        assert!(path_has_prefix("/tmp/root/child.png", "/tmp/root"));
        assert!(path_has_prefix("/tmp/root", "/tmp/root"));
        assert!(!path_has_prefix("/tmp/root-2/child.png", "/tmp/root"));
    }

    #[test]
    fn replace_prefix_updates_nested_path() {
        let replaced =
            replace_path_prefix("/tmp/root/child/file.png", "/tmp/root", "/tmp/other/root")
                .unwrap();
        assert_eq!(replaced, join_path("/tmp/other/root", "child/file.png"));
    }
}
