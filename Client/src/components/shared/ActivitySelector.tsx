/**
 * Activity Selector Component
 * Allows selecting from predefined activities and adding custom ones
 * Styled to match Plan Your Trip theme (orange/yellow gradient)
 */

import { useState, type KeyboardEvent } from 'react';
import { Plus, X, Search } from 'lucide-react';
import { DEFAULT_ACTIVITIES, ACTIVITY_CATEGORIES } from '../../config/domainData/activities';

interface ActivitySelectorProps {
  /** Selected activity labels; also accepts a comma-separated string for legacy callers. */
  activities?: string[] | string;
  /** Called with the full updated list of selected activity labels. */
  onChange: (activities: string[]) => void;
}

const ActivitySelector = ({ activities = [], onChange }: ActivitySelectorProps) => {
  const [showSelector, setShowSelector] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [customActivity, setCustomActivity] = useState('');

  // Convert activities to array if it's a string
  const activitiesArray = Array.isArray(activities) 
    ? activities 
    : (typeof activities === 'string' ? activities.split(',').map(a => a.trim()).filter(Boolean) : []);

  // Filter activities based on category and search
  const filteredActivities = DEFAULT_ACTIVITIES.filter(activity => {
    const matchesCategory = selectedCategory === 'all' || activity.category === selectedCategory;
    const matchesSearch = activity.label.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleAddActivity = (activityLabel: string) => {
    if (!activitiesArray.includes(activityLabel)) {
      onChange([...activitiesArray, activityLabel]);
    }
  };

  const handleRemoveActivity = (activityToRemove: string) => {
    onChange(activitiesArray.filter((a) => a !== activityToRemove));
  };

  const handleAddCustomActivity = () => {
    const trimmed = customActivity.trim();
    if (trimmed && !activitiesArray.includes(trimmed)) {
      onChange([...activitiesArray, trimmed]);
      setCustomActivity('');
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCustomActivity();
    }
  };

  return (
    <div className="space-y-3">
      {/* Selected Activities */}
      {activitiesArray.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activitiesArray.map((activity, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-50 text-green-800 rounded-full text-sm font-medium border border-green-200"
            >
              {activity}
              <button
                type="button"
                onClick={() => handleRemoveActivity(activity)}
                className="hover:bg-purple-200 rounded-full p-0.5 transition-colors ml-1"
              >
                <X size={14} className="text-purple-700" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Toggle Selector Button */}
      <button
        type="button"
        onClick={() => setShowSelector(!showSelector)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#16a34a] hover:bg-[#15803d] text-white rounded-xl transition-colors text-sm font-semibold shadow-md"
      >
        <Plus size={16} />
        {showSelector ? 'Hide Activity Selector' : 'Add Activities'}
      </button>

      {/* Activity Selector Panel */}
      {showSelector && (
        <div className="border-2 border-green-200 rounded-xl p-4 bg-green-50 space-y-4">
          {/* Custom Activity Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Add Custom Activity
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customActivity}
                onChange={(e) => setCustomActivity(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type custom activity name..."
                className="flex-1 px-4 py-2.5 border border-green-300 rounded-xl text-sm bg-white focus:border-green-300 focus:ring-0 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomActivity}
                disabled={!customActivity.trim()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-500 text-white rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-medium"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>

          {/* Category Filter */}
          <div className="border-t border-green-300 pt-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Activity Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-sm bg-white"
            >
              {ACTIVITY_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-green-600" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search activities..."
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-sm bg-white"
            />
          </div>

          {/* Activities Grid */}
          <div className="max-h-64 overflow-y-auto border border-gray-300 rounded-xl bg-white">
            {filteredActivities.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
                {filteredActivities.map((activity) => {
                  const isSelected = activitiesArray.includes(activity.label);
                  return (
                    <button
                      key={activity.value}
                      type="button"
                      onClick={() => handleAddActivity(activity.label)}
                      disabled={isSelected}
                      className={`px-3 py-2 text-left text-sm rounded-xl transition-colors ${
                        isSelected
                          ? 'bg-green-100 text-green-800 cursor-not-allowed border border-green-200'
                          : 'bg-gray-50 hover:bg-gradient-to-r hover:from-green-50 hover:to-green-50 text-gray-700 border border-gray-200 hover:border-green-300'
                      }`}
                    >
                      {activity.label}
                      {isSelected && <span className="ml-2 text-xs text-green-600">✓ Added</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500 text-sm">
                No activities found. Try a different search term or add as custom activity above.
              </div>
            )}
          </div>

          {/* Results Count */}
          {filteredActivities.length > 0 && (
            <div className="text-xs text-gray-600 mt-2 font-medium">
              Showing {filteredActivities.length} activity{filteredActivities.length !== 1 ? 'ies' : ''}
              {selectedCategory !== 'all' && ` in ${ACTIVITY_CATEGORIES.find(c => c.value === selectedCategory)?.label}`}
            </div>
          )}
        </div>
      )}

      {/* Help Text */}
      {activitiesArray.length === 0 && !showSelector && (
        <p className="text-xs text-gray-500">
          Click "Add Activities" to select activities or add custom ones
        </p>
      )}
    </div>
  );
};

export default ActivitySelector;
