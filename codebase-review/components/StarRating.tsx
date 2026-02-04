import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  rating?: number;
  onRate: (rating: number) => void;
  readOnly?: boolean;
}

const StarRating: React.FC<StarRatingProps> = ({ rating = 0, onRate, readOnly = false }) => {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center space-x-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          className={`${readOnly ? 'cursor-default' : 'cursor-pointer'} transition-colors duration-200 focus:outline-none`}
          onClick={() => onRate(star)}
          onMouseEnter={() => !readOnly && setHover(star)}
          onMouseLeave={() => !readOnly && setHover(0)}
        >
          <Star
            size={20}
            className={`${
              star <= (hover || rating)
                ? 'fill-amber-400 text-amber-400'
                : 'fill-none text-slate-300'
            }`}
          />
        </button>
      ))}
    </div>
  );
};

export default StarRating;