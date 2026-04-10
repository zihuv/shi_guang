use image::{DynamicImage, ImageReader};
use std::fs;
use std::io::{BufReader, Cursor};
use std::path::Path;

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
pub(crate) const BACKEND_DECODABLE_IMAGE_EXTENSIONS: [&str; 10] = [
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "avif",
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

pub(crate) fn is_backend_decodable_image_extension(ext: &str) -> bool {
    BACKEND_DECODABLE_IMAGE_EXTENSIONS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(ext))
}

pub(crate) fn load_dynamic_image_from_bytes(bytes: &[u8]) -> Result<DynamicImage, String> {
    let detected_format = image::guess_format(bytes).ok();
    let header = bytes
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");

    let decode_with_reader = || -> Result<DynamicImage, String> {
        let reader = ImageReader::new(BufReader::new(Cursor::new(bytes)))
            .with_guessed_format()
            .map_err(|e| format!("无法识别图片格式: {}", e))?;
        reader
            .decode()
            .map_err(|e| format!("reader decode failed: {}", e))
    };

    decode_with_reader().or_else(|reader_error| {
        image::load_from_memory(bytes).map_err(|memory_error| match detected_format {
            Some(format) => format!(
                "无法读取图片: 内容格式={format:?}，文件头={header}，reader={reader_error}，memory={memory_error}"
            ),
            None => format!(
                "无法识别图片格式，文件可能已损坏或并非图片。文件头={header}，reader={reader_error}，memory={memory_error}"
            ),
        })
    })
}

pub(crate) fn load_dynamic_image_from_path(path: &Path) -> Result<DynamicImage, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("无法读取图片文件 '{}': {}", path.display(), e))?;
    load_dynamic_image_from_bytes(&bytes)
        .map_err(|e| format!("无法读取图片文件 '{}': {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgb};

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

    #[test]
    fn backend_decodable_extension_supports_avif() {
        assert!(is_backend_decodable_image_extension("avif"));
        assert!(is_backend_decodable_image_extension("AVIF"));
    }

    #[test]
    fn load_dynamic_image_from_path_reads_mismatched_extension_from_content() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-media-test-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 3, Rgb([12, 34, 56])));
        image.save_with_format(&path, ImageFormat::Jpeg).unwrap();

        let decoded = load_dynamic_image_from_path(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(decoded.dimensions(), (2, 3));
    }
}
