export type ImageRotation = 0 | 90 | 180 | 270;

export interface ImageTransformState {
  rotation: ImageRotation;
}

export const DEFAULT_IMAGE_TRANSFORM: ImageTransformState = {
  rotation: 0,
};

export function rotateImageTransform(
  transform: ImageTransformState,
  degrees: -90 | 90 | 180,
): ImageTransformState {
  return {
    rotation: normalizeRotation(transform.rotation + degrees),
  };
}

export function getImageTransformValue(transform: ImageTransformState) {
  return `rotate(${transform.rotation}deg)`;
}

export function getRotatedBoundingSize(width: number, height: number, rotation: ImageRotation) {
  return isQuarterTurn(rotation) ? { width: height, height: width } : { width, height };
}

export function getContainedImageLayout({
  containerHeight,
  containerWidth,
  imageHeight,
  imageWidth,
  rotation,
}: {
  containerHeight: number;
  containerWidth: number;
  imageHeight: number;
  imageWidth: number;
  rotation: ImageRotation;
}) {
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const visualNaturalSize = getRotatedBoundingSize(imageWidth, imageHeight, rotation);
  const scale = Math.min(
    1,
    containerWidth / visualNaturalSize.width,
    containerHeight / visualNaturalSize.height,
  );
  const renderedImageWidth = Math.max(1, Math.round(imageWidth * scale));
  const renderedImageHeight = Math.max(1, Math.round(imageHeight * scale));
  const bounds = getRotatedBoundingSize(renderedImageWidth, renderedImageHeight, rotation);

  return {
    boundsHeight: bounds.height,
    boundsWidth: bounds.width,
    imageHeight: renderedImageHeight,
    imageWidth: renderedImageWidth,
  };
}

function normalizeRotation(value: number): ImageRotation {
  return (((value % 360) + 360) % 360) as ImageRotation;
}

function isQuarterTurn(rotation: ImageRotation) {
  return rotation === 90 || rotation === 270;
}
