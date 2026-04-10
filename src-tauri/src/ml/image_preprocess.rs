use image::{imageops::FilterType, DynamicImage, GenericImageView, RgbImage};
use ndarray::{Array, ArrayD, IxDyn};
use std::path::Path;

const PATCH_SIZE: usize = 16;
const PATCH_CHANNELS: usize = PATCH_SIZE * PATCH_SIZE * 3;

pub struct FgClip2ImageInputs {
    pub pixel_values: ArrayD<f32>,
    pub pixel_attention_mask: ArrayD<i32>,
    pub spatial_height: usize,
    pub spatial_width: usize,
    pub max_patches: usize,
}

pub fn preprocess_image_bytes(bytes: &[u8]) -> Result<FgClip2ImageInputs, String> {
    let image = crate::media::load_dynamic_image_from_bytes(bytes)?;
    preprocess_dynamic_image(image)
}

pub fn preprocess_image_path(path: &Path) -> Result<FgClip2ImageInputs, String> {
    let image = crate::media::load_dynamic_image_from_path(path)?;
    preprocess_dynamic_image(image)
}

fn preprocess_dynamic_image(image: DynamicImage) -> Result<FgClip2ImageInputs, String> {
    let (original_width, original_height) = image.dimensions();
    let max_patches =
        determine_max_patches_for_image_size(original_width as usize, original_height as usize);
    preprocess_rgb_image(image.to_rgb8(), max_patches)
}

fn preprocess_rgb_image(image: RgbImage, max_patches: usize) -> Result<FgClip2ImageInputs, String> {
    let (original_width, original_height) = image.dimensions();
    let (target_height, target_width) = get_image_size_for_max_num_patches(
        original_height as usize,
        original_width as usize,
        PATCH_SIZE,
        max_patches,
    );

    let resized = image::imageops::resize(
        &image,
        target_width as u32,
        target_height as u32,
        FilterType::Triangle,
    );
    let spatial_height = target_height / PATCH_SIZE;
    let spatial_width = target_width / PATCH_SIZE;
    let valid_patches = spatial_height * spatial_width;
    if valid_patches > max_patches {
        return Err(format!(
            "图片预处理内部错误: {valid_patches} valid patches > {max_patches} max patches"
        ));
    }

    let mut pixel_values = vec![0.0f32; max_patches * PATCH_CHANNELS];
    for patch_y in 0..spatial_height {
        for patch_x in 0..spatial_width {
            let patch_index = patch_y * spatial_width + patch_x;
            let patch_base = patch_index * PATCH_CHANNELS;
            let mut dst = patch_base;
            for y in 0..PATCH_SIZE {
                for x in 0..PATCH_SIZE {
                    let pixel = resized.get_pixel(
                        (patch_x * PATCH_SIZE + x) as u32,
                        (patch_y * PATCH_SIZE + y) as u32,
                    );
                    for channel in 0..3 {
                        pixel_values[dst] = pixel[channel] as f32 / 127.5 - 1.0;
                        dst += 1;
                    }
                }
            }
        }
    }

    let mut pixel_attention_mask = vec![0i32; max_patches];
    for item in pixel_attention_mask.iter_mut().take(valid_patches) {
        *item = 1;
    }

    Ok(FgClip2ImageInputs {
        pixel_values: Array::from_shape_vec(IxDyn(&[1, max_patches, PATCH_CHANNELS]), pixel_values)
            .map_err(|e| format!("构建 pixel_values 张量失败: {}", e))?,
        pixel_attention_mask: Array::from_shape_vec(IxDyn(&[1, max_patches]), pixel_attention_mask)
            .map_err(|e| format!("构建 pixel_attention_mask 张量失败: {}", e))?,
        spatial_height,
        spatial_width,
        max_patches,
    })
}

fn determine_max_patches_for_image_size(width: usize, height: usize) -> usize {
    let patch_area = (width / PATCH_SIZE) * (height / PATCH_SIZE);
    if patch_area > 784 {
        1024
    } else if patch_area > 576 {
        784
    } else if patch_area > 256 {
        576
    } else if patch_area > 128 {
        256
    } else {
        128
    }
}

fn get_image_size_for_max_num_patches(
    image_height: usize,
    image_width: usize,
    patch_size: usize,
    max_num_patches: usize,
) -> (usize, usize) {
    fn scaled_size(scale: f64, size: usize, patch_size: usize) -> usize {
        let scaled = size as f64 * scale;
        let patched = (scaled / patch_size as f64).ceil() as usize * patch_size;
        patched.max(patch_size)
    }

    let eps = 1e-5f64;
    let mut scale_min = eps / 10.0;
    let mut scale_max = 100.0;
    while scale_max - scale_min >= eps {
        let scale = (scale_min + scale_max) / 2.0;
        let target_height = scaled_size(scale, image_height, patch_size);
        let target_width = scaled_size(scale, image_width, patch_size);
        let num_patches = (target_height / patch_size) * (target_width / patch_size);
        if num_patches <= max_num_patches {
            scale_min = scale;
        } else {
            scale_max = scale;
        }
    }

    (
        scaled_size(scale_min, image_height, patch_size),
        scaled_size(scale_min, image_width, patch_size),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, ImageFormat, Rgb};

    #[test]
    fn preprocess_image_returns_patch_tensor() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(8, 6, Rgb([128, 64, 32])));
        let tensor = preprocess_dynamic_image(image).unwrap();

        assert_eq!(tensor.pixel_values.shape(), &[1, 128, 768]);
        assert_eq!(tensor.pixel_attention_mask.shape(), &[1, 128]);
        assert!(tensor.spatial_height * tensor.spatial_width <= 128);
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

        let tensor = preprocess_image_path(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(tensor.pixel_values.shape(), &[1, 128, 768]);
        assert_eq!(tensor.pixel_attention_mask.shape(), &[1, 128]);
    }
}
