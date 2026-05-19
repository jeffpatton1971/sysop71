import { Link } from 'react-router-dom';
import { hashtagLabel, taxonomyHref } from '../taxonomy';

type ContentTaxonomyFooterProps = {
  hashtags?: string[];
  categories?: string[];
};

export function ContentTaxonomyFooter({ hashtags = [], categories = [] }: ContentTaxonomyFooterProps) {
  if (hashtags.length === 0 && categories.length === 0) {
    return null;
  }

  return (
    <footer className="content-taxonomy" aria-label="Content taxonomy">
      {hashtags.length > 0 ? (
        <div className="content-taxonomy__hashtags">
          {hashtags.map((hashtag) => (
            <Link to={taxonomyHref('hashtags', hashtag)} key={hashtag}>
              {hashtagLabel(hashtag)}
            </Link>
          ))}
        </div>
      ) : null}

      {categories.length > 0 ? (
        <div className="content-taxonomy__categories">
          <span>Categories</span>
          <div>
            {categories.map((category) => (
              <Link to={taxonomyHref('categories', category)} key={category}>
                {category}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </footer>
  );
}
