import { Link } from 'react-router-dom';
import type { ImageSummary } from '../types';

type ImageGridProps = {
  images: ImageSummary[];
  selectedId?: string;
};

export function ImageGrid({ images, selectedId }: ImageGridProps) {
  if (images.length === 0) {
    return <p className="state-text">No images found for this date.</p>;
  }

  return (
    <div className="image-grid">
      {images.map((image) => (
        <Link
          className={image.id === selectedId ? 'image-tile image-tile--active' : 'image-tile'}
          to={image.route}
          key={image.id}
          title={image.title}
        >
          <img src={image.thumbUrl} alt={image.title} loading="lazy" />
        </Link>
      ))}
    </div>
  );
}

