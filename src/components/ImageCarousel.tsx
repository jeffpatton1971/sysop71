import { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ImageSummary } from '../types';

type ImageCarouselProps = {
  images: ImageSummary[];
  title?: string;
};

export function ImageCarousel({ images, title = 'Images' }: ImageCarouselProps) {
  const trackId = useId();

  function scrollCarousel(direction: -1 | 1) {
    const element = document.getElementById(trackId);
    element?.scrollBy({
      left: direction * Math.max(280, element.clientWidth * 0.82),
      behavior: 'smooth',
    });
  }

  if (images.length === 0) {
    return null;
  }

  return (
    <section className="image-carousel" aria-labelledby={`${trackId}-title`}>
      <div className="image-carousel__header">
        <div>
          <h2 id={`${trackId}-title`}>{title}</h2>
          <span>{images.length === 1 ? '1 image' : `${images.length} images`}</span>
        </div>
        <div className="image-carousel__controls">
          <button type="button" title="Previous images" onClick={() => scrollCarousel(-1)}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button type="button" title="Next images" onClick={() => scrollCarousel(1)}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      <div className="image-carousel__track" id={trackId}>
        {images.map((image) => (
          <Link className="image-carousel__item" to={image.route} key={image.id}>
            <img src={image.thumbUrl} alt={image.title} loading="lazy" />
          </Link>
        ))}
      </div>
    </section>
  );
}
