import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  History, 
  BarChart2, 
  Settings, 
  RefreshCw, 
  Sparkles,
  Key
} from 'lucide-react';

import { Article, ViewMode, UserPreferences } from './types';
import * as storage from './services/storage';
import * as geminiService from './services/gemini';
import ArticleCard from './components/ArticleCard';
import TasteChart from './components/TasteChart';

const App: React.FC = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.RECOMMENDATIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInputValue, setKeyInputValue] = useState("");

  // Initial Load
  useEffect(() => {
    const loadedArticles = storage.getArticles();
    const loadedPrefs = storage.getPreferences();
    const loadedKey = storage.getApiKey();

    setArticles(loadedArticles);
    setPreferences(loadedPrefs);
    if (loadedKey) setApiKey(loadedKey);
  }, []);

  // Update preferences whenever ratings change
  useEffect(() => {
    if (articles.length > 0) {
      const updatedPrefs = storage.updateTasteProfile(articles);
      setPreferences(updatedPrefs);
    }
  }, [articles]);

  const handleRate = (id: string, rating: number) => {
    const updatedArticles = articles.map(a => 
      a.id === id ? { ...a, rating, read: true } : a
    );
    setArticles(updatedArticles);
    storage.saveArticles(updatedArticles);
  };

  const handleGenerate = async () => {
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }
    if (!preferences) return;

    setIsLoading(true);
    try {
      const existingUrls = articles.map(a => a.url);
      const partialArticle = await geminiService.generateRecommendation(apiKey, preferences, existingUrls);
      
      const newArticle: Article = {
        id: crypto.randomUUID(),
        title: partialArticle.title || "Unknown Title",
        author: partialArticle.author || "Unknown Author",
        url: partialArticle.url || "#",
        description: partialArticle.description || "No description available.",
        reason: partialArticle.reason || "Matched your general interests.",
        tags: partialArticle.tags || [],
        dateAdded: new Date().toISOString(),
        read: false,
        isVerified: true, // Assuming valid for this demo, usually we'd do a fetch check
        rating: undefined
      };

      const updatedArticles = [newArticle, ...articles];
      setArticles(updatedArticles);
      storage.saveArticles(updatedArticles);
      setViewMode(ViewMode.RECOMMENDATIONS);
    } catch (error) {
      alert("Failed to generate recommendation. Check your API Key or try again later.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = () => {
    if (keyInputValue.trim()) {
      storage.saveApiKey(keyInputValue.trim());
      setApiKey(keyInputValue.trim());
      setShowKeyInput(false);
    }
  };

  const unreadArticles = articles.filter(a => !a.read || a.rating === undefined);
  const historyArticles = articles.filter(a => a.read && a.rating !== undefined);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="bg-slate-900 text-white p-1.5 rounded-lg">
              <BookOpen size={20} />
            </div>
            <span className="font-serif font-bold text-lg text-slate-900">CuriousMind</span>
          </div>
          
          <div className="flex items-center space-x-4">
            <button 
              onClick={handleGenerate}
              disabled={isLoading}
              className={`flex items-center space-x-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-all ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Thinking...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} className="text-amber-300" />
                  <span>Recommend</span>
                </>
              )}
            </button>
            <button onClick={() => setShowKeyInput(true)} className="text-slate-400 hover:text-slate-600">
               <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        
        {/* Navigation Tabs */}
        <div className="flex space-x-6 border-b border-slate-200 mb-8 overflow-x-auto">
          <button
            onClick={() => setViewMode(ViewMode.RECOMMENDATIONS)}
            className={`pb-3 text-sm font-medium transition-colors whitespace-nowrap ${
              viewMode === ViewMode.RECOMMENDATIONS 
                ? 'text-slate-900 border-b-2 border-slate-900' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            For You <span className="ml-1 bg-slate-100 px-1.5 py-0.5 rounded-full text-xs">{unreadArticles.length}</span>
          </button>
          <button
            onClick={() => setViewMode(ViewMode.HISTORY)}
            className={`pb-3 text-sm font-medium transition-colors whitespace-nowrap ${
              viewMode === ViewMode.HISTORY 
                ? 'text-slate-900 border-b-2 border-slate-900' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            History <span className="ml-1 bg-slate-100 px-1.5 py-0.5 rounded-full text-xs">{historyArticles.length}</span>
          </button>
          <button
            onClick={() => setViewMode(ViewMode.INSIGHTS)}
            className={`pb-3 text-sm font-medium transition-colors whitespace-nowrap ${
              viewMode === ViewMode.INSIGHTS 
                ? 'text-slate-900 border-b-2 border-slate-900' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Insights
          </button>
        </div>

        {/* Views */}
        <div className="space-y-6">
          {viewMode === ViewMode.RECOMMENDATIONS && (
            <div className="space-y-6">
              {unreadArticles.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
                  <BookOpen size={48} className="mx-auto text-slate-300 mb-4" />
                  <h3 className="text-lg font-medium text-slate-900">No new recommendations</h3>
                  <p className="text-slate-500 mb-6 max-w-sm mx-auto">
                    You're all caught up! Click the "Recommend" button to find something new to read.
                  </p>
                  <button 
                    onClick={handleGenerate}
                    className="text-blue-600 font-medium hover:underline"
                  >
                    Generate one now
                  </button>
                </div>
              ) : (
                unreadArticles.map(article => (
                  <ArticleCard key={article.id} article={article} onRate={handleRate} />
                ))
              )}
            </div>
          )}

          {viewMode === ViewMode.HISTORY && (
            <div className="space-y-6">
               {historyArticles.length === 0 ? (
                <div className="text-center py-12">
                  <History size={48} className="mx-auto text-slate-300 mb-4" />
                  <p className="text-slate-500">No reading history yet. Rate items to see them here.</p>
                </div>
              ) : (
                historyArticles.map(article => (
                  <ArticleCard key={article.id} article={article} onRate={handleRate} />
                ))
              )}
            </div>
          )}

          {viewMode === ViewMode.INSIGHTS && preferences && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                 <TasteChart data={preferences.weights} />
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h3 className="font-serif font-bold text-lg mb-4">Top Interests</h3>
                <div className="space-y-3">
                  {[...preferences.weights].sort((a,b) => b.weight - a.weight).slice(0, 5).map((w, idx) => (
                    <div key={w.tag} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">
                        {idx + 1}. {w.tag}
                      </span>
                      <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-blue-600 h-full rounded-full" 
                          style={{ width: `${Math.min(100, Math.max(0, w.weight))}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                  <p>
                    <strong>Tip:</strong> Rating articles 4 or 5 stars increases the weight of their tags. 
                    Rating 1 or 2 stars decreases them. The system adapts over time.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* API Key Modal */}
      {showKeyInput && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center space-x-3 mb-4 text-slate-900">
              <Key size={24} className="text-blue-600" />
              <h3 className="text-xl font-serif font-bold">API Configuration</h3>
            </div>
            <p className="text-slate-600 mb-4 text-sm">
              To generate recommendations, this app needs a Google Gemini API Key. 
              The key is stored locally in your browser.
            </p>
            <input
              type="password"
              placeholder="Enter Gemini API Key"
              className="w-full border border-slate-300 rounded-lg px-4 py-2 mb-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              value={keyInputValue}
              onChange={(e) => setKeyInputValue(e.target.value)}
            />
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setShowKeyInput(false)}
                className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveKey}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;