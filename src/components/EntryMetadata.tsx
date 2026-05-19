import type { PostSummary } from '../types';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { stripPrefix, taxonomyHref } from '../taxonomy';

type EntryMetadataProps = {
  entry: PostSummary;
};

export function EntryMetadata({ entry }: EntryMetadataProps) {
  const handles = entry.handles ?? [];
  const people = entry.people ?? [];
  const locations = entry.locations ?? (entry.location ? [entry.location] : []);

  if (
    handles.length === 0 &&
    people.length === 0 &&
    locations.length === 0
  ) {
    return null;
  }

  return (
    <div className="entry-meta">
      <ChipGroup label="People" values={people} hrefForValue={(value) => taxonomyHref('people', value)} />
      <ChipGroup label="Locations" values={locations} hrefForValue={(value) => taxonomyHref('locations', value)} />
      <ChipGroup
        label="Handles"
        values={handles}
        renderValue={(value) => (
          <a href={instagramHandleUrl(value)} target="_blank" rel="noopener noreferrer">
            @{stripPrefix(value, '@')}
          </a>
        )}
      />
    </div>
  );
}

function ChipGroup({
  label,
  values,
  renderValue,
  hrefForValue,
}: {
  label: string;
  values: string[];
  renderValue?: (value: string) => ReactNode;
  hrefForValue?: (value: string) => string;
}) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="entry-meta__group">
      <span className="entry-meta__label">{label}</span>
      {values.map((value) => {
        const content = renderValue ? renderValue(value) : value;
        const href = hrefForValue?.(value);

        return (
          <span className="entry-meta__chip" key={`${label}-${value}`}>
            {href ? <Link to={href}>{content}</Link> : content}
          </span>
        );
      })}
    </div>
  );
}

function instagramHandleUrl(value: string) {
  return `https://www.instagram.com/${encodeURIComponent(stripPrefix(value, '@'))}/`;
}
