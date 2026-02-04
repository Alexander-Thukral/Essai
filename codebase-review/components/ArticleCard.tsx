import React from 'react';
import { Article } from '../types';
import StarRating from './StarRating';
import { ExternalLink, CheckCircle2, Clock } from 'lucide-react';

interface ArticleCardProps {
  article: Article;
  onRate: (id: string, rating: number) => void;
  onDelete?: (id: string) => void;
}

const ArticleCard: React.FC<ArticleCardProps> = ({ article, onRate }) => {
  const handleRate = (rating: number) => {
    onRate(article.id, rating);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow duration-300">
      <div className="p-6">
        <div className="flex justify-between items-start mb-2">
          <div className="flex gap-2 mb-3">
            {article.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
          {article.isVerified && (
            <div className="flex items-center text-emerald-600 text-xs" title="Link Verified">
              <CheckCircle2 size={14} className="mr-1" />
              <span>Verified</span>
            </div>
          )}
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-1 font-serif leading-tight">
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700 hover:underline decoration-2 underline-offset-2">
            {article.title}
          </a>
        </h3>
        <p className="text-sm text-slate-500 mb-4 font-medium">by {article.author}</p>

        <p className="text-slate-700 leading-relaxed mb-4 text-sm">
          {article.description}
        </p>

        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 mb-4">
          <p className="text-xs text-blue-800 italic">
            <span className="font-semibold not-italic">Why suggested:</span> {article.reason}
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
             <span className="text-xs text-slate-400 flex items-center">
               <Clock size={12} className="mr-1"/> 
               {new Date(article.dateAdded).toLocaleDateString()}
             </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Your Rating
            </span>
            <StarRating rating={article.rating} onRate={handleRate} />
          </div>
        </div>
      </div>
      
      <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 flex justify-between items-center">
         <a 
          href={article.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center"
        >
          Read Article <ExternalLink size={14} className="ml-1" />
        </a>
      </div>
    </div>
  );
};

export default ArticleCard;