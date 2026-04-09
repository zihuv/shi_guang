#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MediaTypeMapping {
    pub mime_type: &'static str,
    pub extension: &'static str,
}

const IMAGE_MEDIA_TYPE_MAPPINGS: [MediaTypeMapping; 17] = [
    MediaTypeMapping {
        mime_type: "image/png",
        extension: "png",
    },
    MediaTypeMapping {
        mime_type: "image/apng",
        extension: "png",
    },
    MediaTypeMapping {
        mime_type: "image/jpeg",
        extension: "jpg",
    },
    MediaTypeMapping {
        mime_type: "image/jpg",
        extension: "jpg",
    },
    MediaTypeMapping {
        mime_type: "image/pjpeg",
        extension: "jpg",
    },
    MediaTypeMapping {
        mime_type: "image/gif",
        extension: "gif",
    },
    MediaTypeMapping {
        mime_type: "image/webp",
        extension: "webp",
    },
    MediaTypeMapping {
        mime_type: "image/avif",
        extension: "avif",
    },
    MediaTypeMapping {
        mime_type: "image/heic",
        extension: "heic",
    },
    MediaTypeMapping {
        mime_type: "image/heic-sequence",
        extension: "heic",
    },
    MediaTypeMapping {
        mime_type: "image/heif",
        extension: "heif",
    },
    MediaTypeMapping {
        mime_type: "image/heif-sequence",
        extension: "heif",
    },
    MediaTypeMapping {
        mime_type: "image/svg+xml",
        extension: "svg",
    },
    MediaTypeMapping {
        mime_type: "image/bmp",
        extension: "bmp",
    },
    MediaTypeMapping {
        mime_type: "image/x-ms-bmp",
        extension: "bmp",
    },
    MediaTypeMapping {
        mime_type: "image/x-icon",
        extension: "ico",
    },
    MediaTypeMapping {
        mime_type: "image/vnd.microsoft.icon",
        extension: "ico",
    },
];

const TIFF_MEDIA_TYPE_MAPPINGS: [MediaTypeMapping; 2] = [
    MediaTypeMapping {
        mime_type: "image/tiff",
        extension: "tiff",
    },
    MediaTypeMapping {
        mime_type: "image/tif",
        extension: "tiff",
    },
];

pub(crate) const VISUAL_SEARCH_SUPPORTED_EXTENSIONS: [&str; 12] = [
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "avif", "heic", "heif",
];

fn normalize_content_type(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase()
}

fn has_signature(bytes: &[u8], signature: &[u8], offset: usize) -> bool {
    bytes.len() >= offset + signature.len() && &bytes[offset..offset + signature.len()] == signature
}

fn ascii_slice(bytes: &[u8], start: usize, end: usize) -> Option<String> {
    if bytes.len() < end {
        return None;
    }

    Some(
        bytes[start..end]
            .iter()
            .map(|byte| char::from(*byte))
            .collect::<String>(),
    )
}

pub(crate) fn extension_from_content_type(content_type: Option<&str>) -> Option<&'static str> {
    let normalized = normalize_content_type(content_type?);

    IMAGE_MEDIA_TYPE_MAPPINGS
        .iter()
        .chain(TIFF_MEDIA_TYPE_MAPPINGS.iter())
        .find(|mapping| mapping.mime_type == normalized)
        .map(|mapping| mapping.extension)
}

pub(crate) fn extension_from_magic_bytes(data: &[u8]) -> Option<&'static str> {
    if has_signature(data, &[0x89, 0x50, 0x4E, 0x47], 0) {
        return Some("png");
    }
    if has_signature(data, &[0xFF, 0xD8, 0xFF], 0) {
        return Some("jpg");
    }
    if ascii_slice(data, 0, 4).as_deref() == Some("GIF8") {
        return Some("gif");
    }
    if ascii_slice(data, 0, 4).as_deref() == Some("RIFF")
        && ascii_slice(data, 8, 12).as_deref() == Some("WEBP")
    {
        return Some("webp");
    }
    if has_signature(data, &[0x42, 0x4D], 0) {
        return Some("bmp");
    }
    if has_signature(data, &[0x49, 0x49, 0x2A, 0x00], 0)
        || has_signature(data, &[0x4D, 0x4D, 0x00, 0x2A], 0)
    {
        return Some("tiff");
    }
    if has_signature(data, &[0x00, 0x00, 0x01, 0x00], 0) {
        return Some("ico");
    }

    if ascii_slice(data, 4, 8).as_deref() == Some("ftyp") {
        let brands = ascii_slice(data, 8, data.len().min(32)).unwrap_or_default();
        if brands.contains("avif") || brands.contains("avis") {
            return Some("avif");
        }
        if ["heic", "heix", "hevc", "hevx"]
            .iter()
            .any(|brand| brands.contains(brand))
        {
            return Some("heic");
        }
        if ["mif1", "msf1", "heif", "heis", "heim", "hevm", "hevs"]
            .iter()
            .any(|brand| brands.contains(brand))
        {
            return Some("heif");
        }
    }

    let head = String::from_utf8_lossy(&data[..data.len().min(256)])
        .trim_start()
        .to_string();
    if head.starts_with("<svg") || head.starts_with("<?xml") {
        return Some("svg");
    }

    None
}

pub(crate) fn detect_extension_from_content(
    content_type: Option<&str>,
    data: &[u8],
) -> Option<&'static str> {
    extension_from_content_type(content_type).or_else(|| extension_from_magic_bytes(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_type_detection_supports_avif() {
        assert_eq!(
            extension_from_content_type(Some("image/avif")),
            Some("avif")
        );
        assert_eq!(
            extension_from_content_type(Some("image/avif; charset=binary")),
            Some("avif")
        );
    }

    #[test]
    fn magic_byte_detection_supports_avif() {
        let bytes = [
            0x00, 0x00, 0x00, 0x1C, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f', 0x00, 0x00,
            0x00, 0x00,
        ];

        assert_eq!(extension_from_magic_bytes(&bytes), Some("avif"));
    }

    #[test]
    fn detect_extension_falls_back_to_magic_bytes() {
        let bytes = [
            0x00, 0x00, 0x00, 0x1C, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c', 0x00, 0x00,
            0x00, 0x00,
        ];

        assert_eq!(
            detect_extension_from_content(Some("application/octet-stream"), &bytes),
            Some("heic")
        );
    }
}
