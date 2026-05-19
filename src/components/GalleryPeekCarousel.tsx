import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ImageSummary } from '../types';

type GalleryPeekCarouselProps = {
  images: ImageSummary[];
  title?: string;
};

export function GalleryPeekCarousel({ images, title = 'Gallery images' }: GalleryPeekCarouselProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = images[selectedIndex];
  const hasMultipleImages = images.length > 1;
  const previous = hasMultipleImages ? images[(selectedIndex - 1 + images.length) % images.length] : undefined;
  const next = hasMultipleImages ? images[(selectedIndex + 1) % images.length] : undefined;

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(images.length - 1, 0)));
  }, [images.length]);

  function move(direction: -1 | 1) {
    if (!hasMultipleImages) {
      return;
    }

    setSelectedIndex((index) => (index + direction + images.length) % images.length);
  }

  if (!selected) {
    return null;
  }

  return (
    <section className="gallery-peek-carousel" aria-label={title}>
      <div className="gallery-peek-carousel__stage">
        {previous ? (
          <button
            type="button"
            className="gallery-peek-carousel__peek gallery-peek-carousel__peek--previous"
            title="Previous image"
            onClick={() => move(-1)}
          >
            <img src={previous.thumbUrl} alt="" loading="lazy" />
          </button>
        ) : null}

        <figure className="gallery-peek-carousel__main">
          <img src={selected.rawUrl || selected.thumbUrl} alt={selected.alt || selected.title} loading="lazy" />
          <figcaption>
            <span>{selected.caption || selected.title}</span>
            <strong>
              {selectedIndex + 1} / {images.length}
            </strong>
          </figcaption>
        </figure>

        {next ? (
          <button
            type="button"
            className="gallery-peek-carousel__peek gallery-peek-carousel__peek--next"
            title="Next image"
            onClick={() => move(1)}
          >
            <img src={next.thumbUrl} alt="" loading="lazy" />
          </button>
        ) : null}
      </div>

      {hasMultipleImages ? (
        <div className="gallery-peek-carousel__controls" aria-label="Gallery image controls">
          <button type="button" title="Previous image" onClick={() => move(-1)}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <span>
            {selectedIndex + 1} of {images.length}
          </span>
          <button type="button" title="Next image" onClick={() => move(1)}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
