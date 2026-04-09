use image::{imageops::FilterType, DynamicImage};
use ndarray::Array4;
use std::fs;
use std::path::Path;

pub const DEFAULT_IMAGE_SIZE: usize = 224;
const IMAGE_MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const IMAGE_STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

fn convert_to_rgb(image: DynamicImage) -> image::RgbImage {
    image.to_rgb8()
}

fn load_image_from_bytes(bytes: &[u8]) -> Result<DynamicImage, String> {
    if let Ok(format) = image::guess_format(bytes) {
        return image::load_from_memory_with_format(bytes, format)
            .map_err(|e| format!("无法按检测到的格式读取图片: {}", e));
    }

    image::load_from_memory(bytes).map_err(|e| format!("无法读取图片内容: {}", e))
}

pub fn preprocess_image_bytes(bytes: &[u8], image_size: usize) -> Result<Array4<f32>, String> {
    let image = load_image_from_bytes(bytes).map_err(|e| format!("无法读取图片: {}", e))?;
    let rgb_image = convert_to_rgb(image);
    let resized = image::imageops::resize(
        &rgb_image,
        image_size as u32,
        image_size as u32,
        FilterType::CatmullRom,
    );

    let mut tensor = Array4::<f32>::zeros((1, 3, image_size, image_size));
    for (x, y, pixel) in resized.enumerate_pixels() {
        let channels = pixel.0;
        for channel_index in 0..3 {
            let value = channels[channel_index] as f32 / 255.0;
            tensor[[0, channel_index, y as usize, x as usize]] =
                (value - IMAGE_MEAN[channel_index]) / IMAGE_STD[channel_index];
        }
    }

    Ok(tensor)
}

pub fn preprocess_image_path(path: &Path, image_size: usize) -> Result<Array4<f32>, String> {
    let bytes = fs::read(path).map_err(|e| format!("无法读取图片 '{}': {}", path.display(), e))?;
    preprocess_image_bytes(&bytes, image_size)
        .map_err(|e| format!("无法读取图片 '{}': {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, ImageFormat, Rgb};

    #[test]
    fn preprocess_image_returns_expected_shape() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-preprocess-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let image = ImageBuffer::from_pixel(8, 6, Rgb([128u8, 64u8, 32u8]));
        image.save(&path).unwrap();

        let tensor = preprocess_image_path(&path, DEFAULT_IMAGE_SIZE).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(
            tensor.shape(),
            &[1, 3, DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_SIZE]
        );
    }

    #[test]
    fn preprocess_image_reads_mismatched_extension_from_content() {
        let path = std::env::temp_dir().join(format!(
            "shiguang-visual-preprocess-mismatch-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let image = ImageBuffer::from_pixel(8, 6, Rgb([128u8, 64u8, 32u8]));
        image.save_with_format(&path, ImageFormat::Jpeg).unwrap();

        let tensor = preprocess_image_path(&path, DEFAULT_IMAGE_SIZE).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(
            tensor.shape(),
            &[1, 3, DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_SIZE]
        );
    }
}
