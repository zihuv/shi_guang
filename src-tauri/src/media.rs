use image::{DynamicImage, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufReader, Cursor, Read};
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

const OTHER_MEDIA_TYPE_MAPPINGS: [MediaTypeMapping; 10] = [
    MediaTypeMapping {
        mime_type: "application/pdf",
        extension: "pdf",
    },
    MediaTypeMapping {
        mime_type: "video/mp4",
        extension: "mp4",
    },
    MediaTypeMapping {
        mime_type: "video/quicktime",
        extension: "mov",
    },
    MediaTypeMapping {
        mime_type: "video/webm",
        extension: "webm",
    },
    MediaTypeMapping {
        mime_type: "video/x-matroska",
        extension: "mkv",
    },
    MediaTypeMapping {
        mime_type: "video/x-msvideo",
        extension: "avi",
    },
    MediaTypeMapping {
        mime_type: "video/x-ms-wmv",
        extension: "wmv",
    },
    MediaTypeMapping {
        mime_type: "video/x-flv",
        extension: "flv",
    },
    MediaTypeMapping {
        mime_type: "video/3gpp",
        extension: "3gp",
    },
    MediaTypeMapping {
        mime_type: "image/vnd.adobe.photoshop",
        extension: "psd",
    },
];

pub(crate) const VISUAL_SEARCH_SUPPORTED_EXTENSIONS: [&str; 12] = [
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "avif", "heic", "heif",
];
pub(crate) const BACKEND_DECODABLE_IMAGE_EXTENSIONS: [&str; 10] = [
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "avif",
];
pub(crate) const SCAN_SUPPORTED_EXTENSIONS: [&str; 29] = [
    "jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico", "tiff", "avif", "psd", "ai", "eps",
    "cr2", "nef", "arw", "dng", "heic", "heif", "pdf", "mp4", "avi", "mov", "mkv", "wmv", "flv",
    "webm", "m4v", "3gp",
];
pub(crate) const AI_SUPPORTED_IMAGE_EXTENSIONS: [&str; 12] = [
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "avif", "heic", "heif",
];
const PROBE_READ_LIMIT: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MediaProbe {
    detected_extension: Option<&'static str>,
}

impl MediaProbe {
    pub(crate) fn detected_extension(self) -> Option<&'static str> {
        self.detected_extension
    }

    pub(crate) fn is_scan_supported(self) -> bool {
        self.detected_extension
            .map(is_scan_supported_extension)
            .unwrap_or(false)
    }

    pub(crate) fn is_svg(self) -> bool {
        self.detected_extension == Some("svg")
    }

    pub(crate) fn is_backend_decodable_image(self) -> bool {
        self.detected_extension
            .map(is_backend_decodable_image_extension)
            .unwrap_or(false)
    }

    pub(crate) fn is_visual_search_supported(self) -> bool {
        self.detected_extension
            .map(is_visual_search_supported_extension)
            .unwrap_or(false)
    }

    pub(crate) fn is_ai_supported_image(self) -> bool {
        self.detected_extension
            .map(is_ai_supported_image_extension)
            .unwrap_or(false)
    }

    pub(crate) fn can_extract_colors(self) -> bool {
        self.is_backend_decodable_image()
    }

    pub(crate) fn requires_browser_decode_for_color_extraction(self) -> bool {
        self.is_ai_supported_image() && !self.is_backend_decodable_image()
    }

    pub(crate) fn requires_browser_decode_for_ai(self) -> bool {
        self.is_ai_supported_image() && !self.is_backend_decodable_image()
    }

    pub(crate) fn requires_browser_decode_for_visual_index(self) -> bool {
        self.is_visual_search_supported() && !self.is_backend_decodable_image()
    }
}

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

fn extension_from_guessed_image_format(data: &[u8]) -> Option<&'static str> {
    match image::guess_format(data).ok()? {
        ImageFormat::Png => Some("png"),
        ImageFormat::Jpeg => Some("jpg"),
        ImageFormat::Gif => Some("gif"),
        ImageFormat::WebP => Some("webp"),
        ImageFormat::Bmp => Some("bmp"),
        ImageFormat::Tiff => Some("tiff"),
        ImageFormat::Ico => Some("ico"),
        ImageFormat::Avif => Some("avif"),
        _ => None,
    }
}

fn head_ascii_lowercase(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(PROBE_READ_LIMIT)])
        .trim_start_matches('\u{feff}')
        .to_ascii_lowercase()
}

fn is_tiff_family(bytes: &[u8]) -> bool {
    has_signature(bytes, &[0x49, 0x49, 0x2A, 0x00], 0)
        || has_signature(bytes, &[0x4D, 0x4D, 0x00, 0x2A], 0)
}

fn is_bmff(bytes: &[u8]) -> bool {
    ascii_slice(bytes, 4, 8).as_deref() == Some("ftyp")
}

fn bmff_brands(bytes: &[u8]) -> Option<String> {
    if !is_bmff(bytes) {
        return None;
    }

    Some(
        String::from_utf8_lossy(&bytes[8..bytes.len().min(64)])
            .to_ascii_lowercase()
            .to_string(),
    )
}

pub(crate) fn extension_from_content_type(content_type: Option<&str>) -> Option<&'static str> {
    let normalized = normalize_content_type(content_type?);

    IMAGE_MEDIA_TYPE_MAPPINGS
        .iter()
        .chain(TIFF_MEDIA_TYPE_MAPPINGS.iter())
        .chain(OTHER_MEDIA_TYPE_MAPPINGS.iter())
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
    if ascii_slice(data, 0, 4).as_deref() == Some("RIFF")
        && ascii_slice(data, 8, 12).as_deref() == Some("AVI ")
    {
        return Some("avi");
    }
    if has_signature(data, &[0x42, 0x4D], 0) {
        return Some("bmp");
    }
    if is_tiff_family(data) {
        let ascii_head = head_ascii_lowercase(data);
        if ascii_slice(data, 8, 10).as_deref() == Some("CR") {
            return Some("cr2");
        }
        if ascii_head.contains("nikon") {
            return Some("nef");
        }
        if ascii_head.contains("sony") {
            return Some("arw");
        }
        if ascii_head.contains("adobe dng") || ascii_head.contains(" dng") {
            return Some("dng");
        }
        return Some("tiff");
    }
    if has_signature(data, &[0x00, 0x00, 0x01, 0x00], 0) {
        return Some("ico");
    }

    if let Some(brands) = bmff_brands(data) {
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
        if brands.contains("qt  ") {
            return Some("mov");
        }
        if brands.contains("m4v") {
            return Some("m4v");
        }
        if ["3gp", "3g2", "3gr", "3gs"]
            .iter()
            .any(|brand| brands.contains(brand))
        {
            return Some("3gp");
        }
        if ["mp4", "isom", "iso2", "iso5", "iso6", "avc1", "dash"]
            .iter()
            .any(|brand| brands.contains(brand))
        {
            return Some("mp4");
        }
    }

    if has_signature(
        data,
        &[
            0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62,
            0xCE, 0x6C,
        ],
        0,
    ) {
        return Some("wmv");
    }

    if ascii_slice(data, 0, 3).as_deref() == Some("FLV") {
        return Some("flv");
    }

    if has_signature(data, &[0x1A, 0x45, 0xDF, 0xA3], 0) {
        let ascii_head = head_ascii_lowercase(data);
        if ascii_head.contains("webm") {
            return Some("webm");
        }
        if ascii_head.contains("matroska") {
            return Some("mkv");
        }
    }

    if ascii_slice(data, 0, 4).as_deref() == Some("8BPS") {
        return Some("psd");
    }

    let ascii_head = head_ascii_lowercase(data);
    if ascii_head.starts_with("%pdf-") {
        if ascii_head.contains("illustrator") {
            return Some("ai");
        }
        return Some("pdf");
    }

    if ascii_head.starts_with("%!ps-adobe-") {
        if ascii_head.contains("illustrator") {
            return Some("ai");
        }
        if ascii_head.contains("epsf-") {
            return Some("eps");
        }
        return Some("eps");
    }

    if ascii_head.starts_with("<svg") || ascii_head.starts_with("<?xml") {
        return Some("svg");
    }

    None
}

pub(crate) fn detect_extension_from_content(
    content_type: Option<&str>,
    data: &[u8],
) -> Option<&'static str> {
    extension_from_magic_bytes(data)
        .or_else(|| extension_from_guessed_image_format(data))
        .or_else(|| extension_from_content_type(content_type))
}

pub(crate) fn is_scan_supported_extension(ext: &str) -> bool {
    SCAN_SUPPORTED_EXTENSIONS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(ext))
}

pub(crate) fn is_backend_decodable_image_extension(ext: &str) -> bool {
    BACKEND_DECODABLE_IMAGE_EXTENSIONS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(ext))
}

pub(crate) fn is_visual_search_supported_extension(ext: &str) -> bool {
    VISUAL_SEARCH_SUPPORTED_EXTENSIONS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(ext))
}

pub(crate) fn is_ai_supported_image_extension(ext: &str) -> bool {
    AI_SUPPORTED_IMAGE_EXTENSIONS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(ext))
}

pub(crate) fn probe_media_from_bytes(content_type: Option<&str>, bytes: &[u8]) -> MediaProbe {
    MediaProbe {
        detected_extension: detect_extension_from_content(content_type, bytes),
    }
}

pub(crate) fn probe_media_path(path: &Path) -> Result<MediaProbe, String> {
    let mut file = fs::File::open(path)
        .map_err(|e| format!("无法读取媒体文件 '{}': {}", path.display(), e))?;
    let mut bytes = vec![0; PROBE_READ_LIMIT];
    let read = file
        .read(&mut bytes)
        .map_err(|e| format!("无法读取媒体文件 '{}': {}", path.display(), e))?;
    bytes.truncate(read);
    Ok(probe_media_from_bytes(None, &bytes))
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

pub(crate) fn compute_visual_content_hash_from_bytes(bytes: &[u8]) -> Result<String, String> {
    let image = load_dynamic_image_from_bytes(bytes)?;
    Ok(compute_visual_content_hash(image))
}

pub(crate) fn compute_visual_content_hash_from_path(path: &Path) -> Result<String, String> {
    let image = load_dynamic_image_from_path(path)?;
    Ok(compute_visual_content_hash(image))
}

fn compute_visual_content_hash(image: DynamicImage) -> String {
    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    let mut hasher = Sha256::new();
    hasher.update(width.to_le_bytes());
    hasher.update(height.to_le_bytes());
    hasher.update(rgb.as_raw());
    format!("{:x}", hasher.finalize())
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
    fn detect_extension_prefers_magic_bytes_over_content_type() {
        let bytes = [0xFF, 0xD8, 0xFF, 0xDB];
        assert_eq!(
            detect_extension_from_content(Some("image/png"), &bytes),
            Some("jpg")
        );
    }

    #[test]
    fn magic_byte_detection_supports_pdf_and_video_formats() {
        let pdf = b"%PDF-1.7\n";
        assert_eq!(extension_from_magic_bytes(pdf), Some("pdf"));

        let mp4 = [
            0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm', 0x00, 0x00,
            0x02, 0x00,
        ];
        assert_eq!(extension_from_magic_bytes(&mp4), Some("mp4"));

        let avi = [
            b'R', b'I', b'F', b'F', 0x24, 0x00, 0x00, 0x00, b'A', b'V', b'I', b' ',
        ];
        assert_eq!(extension_from_magic_bytes(&avi), Some("avi"));
    }

    #[test]
    fn magic_byte_detection_supports_design_formats() {
        assert_eq!(
            extension_from_magic_bytes(&[b'8', b'B', b'P', b'S', 0x00, 0x01]),
            Some("psd")
        );
        assert_eq!(
            extension_from_magic_bytes(b"%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator"),
            Some("ai")
        );
    }

    #[test]
    fn probe_reports_visual_search_and_ai_capabilities_from_content() {
        let avif = [
            0x00, 0x00, 0x00, 0x1C, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f', 0x00, 0x00,
            0x00, 0x00,
        ];
        let probe = probe_media_from_bytes(None, &avif);
        assert_eq!(probe.detected_extension(), Some("avif"));
        assert!(probe.is_visual_search_supported());
        assert!(probe.is_ai_supported_image());
        assert!(!probe.requires_browser_decode_for_visual_index());
        assert!(!probe.requires_browser_decode_for_ai());
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

    #[test]
    fn load_dynamic_image_from_path_reads_avif_content() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-media-test-{}-{}.avif",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 3, Rgb([12, 34, 56])));
        image.save_with_format(&path, ImageFormat::Avif).unwrap();

        let decoded = load_dynamic_image_from_path(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(decoded.dimensions(), (2, 3));
    }
}
