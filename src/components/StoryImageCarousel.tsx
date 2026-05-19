import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ImageSummary } from '../types';

type StoryImageCarouselProps = {
  images: ImageSummary[];
  title?: string;
};

export function StoryImageCarousel({ images, title = 'Story images' }: StoryImageCarouselProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = images[selectedIndex];
  const hasMultipleImages = images.length > 1;

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
    <section className="story-image-carousel" aria-label={title}>
      <div className="story-image-carousel__frame">
        <img src={selected.rawUrl || selected.thumbUrl} alt={selected.alt || selected.title} loading="lazy" />
      </div>

      <div className="story-image-carousel__controls" aria-label="Story image controls">
        {hasMultipleImages ? (
          <button type="button" title="Previous image" onClick={() => move(-1)}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
        ) : null}

        <span>
          {selectedIndex + 1} / {images.length}
        </span>

        {hasMultipleImages ? (
          <button type="button" title="Next image" onClick={() => move(1)}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>

      {hasMultipleImages && images.length <= 10 ? (
        <div className="story-image-carousel__dots" aria-label="Choose image">
          {images.map((image, index) => (
            <button
              type="button"
              className={index === selectedIndex ? 'is-active' : undefined}
              aria-label={`Show image ${index + 1}`}
              aria-current={index === selectedIndex}
              onClick={() => setSelectedIndex(index)}
              key={image.id}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
