import { useState } from 'react';
import { CareerContainer, VacanciesContainer } from '../features/career';
import { Briefcase, Users } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type TabId = 'applications' | 'vacancies';

const tabs: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'applications', label: 'Applications', icon: Users },
  { id: 'vacancies', label: 'Vacancies', icon: Briefcase },
];

const CareerManagement = () => {
  const [activeTab, setActiveTab] = useState<TabId>('applications');

  return (
      <div className="h-full flex flex-col bg-background">
      <div className="bg-card border-b border-border px-4 sm:px-8 py-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => value && setActiveTab(value as TabId)}
        >
          <TabsList>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'vacancies' && <VacanciesContainer />}
        {activeTab === 'applications' && <CareerContainer />}
      </div>
      </div>
  );
};

export default CareerManagement;
