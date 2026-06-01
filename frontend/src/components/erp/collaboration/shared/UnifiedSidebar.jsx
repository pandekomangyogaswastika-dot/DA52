/**
 * UnifiedSidebar.jsx
 * Left sidebar for Collaboration Portal
 * Contains: Tab switcher icons and context-aware navigation
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function UnifiedSidebar({
  activeTab,
  onTabChange,
  isOpen,
  onToggle,
  tabs,
  learningView,
  onLearningNavigate,
}) {
  return (
    <>
      {/* Sidebar */}
      <aside
        className={cn(
          "bg-card border-r flex flex-col transition-all duration-300",
          isOpen ? "w-64" : "w-16"
        )}
      >
        {/* Tab Switcher */}
        <div className="p-3 border-b space-y-2">
          {Object.values(tabs).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            
            return (
              <Button
                key={tab.id}
                variant={isActive ? 'default' : 'ghost'}
                size="sm"
                className={cn(
                  "w-full justify-start gap-3",
                  !isOpen && "justify-center px-2"
                )}
                onClick={() => onTabChange(tab.id)}
                data-testid={`tab-${tab.id}`}
              >
                <Icon size={20} />
                {isOpen && <span>{tab.label}</span>}
              </Button>
            );
          })}
        </div>

        {/* Context-Aware Navigation */}
        <div className="flex-1 overflow-y-auto p-3">
          {isOpen ? (
            <div className="space-y-4">
              {activeTab === 'communication' && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Komunikasi
                  </h3>
                  <p className="text-xs text-muted-foreground px-3">
                    Pilih channel atau DM dari panel sebelah kanan →
                  </p>
                </div>
              )}

              {activeTab === 'workspace' && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Workspace
                  </h3>
                  <p className="text-xs text-muted-foreground px-3">
                    Navigate within Workspace tab
                  </p>
                </div>
              )}

              {activeTab === 'learning' && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Learning
                  </h3>
                  <div className="space-y-1">
                    {[
                      { view: 'home', icon: '🏠', label: 'Home' },
                      { view: 'catalog', icon: '📖', label: 'Katalog Course' },
                      { view: 'my-courses', icon: '📚', label: 'My Courses' },
                      { view: 'certificates', icon: '🎓', label: 'Sertifikat' },
                      { view: 'study-groups', icon: '👥', label: 'Study Groups' },
                    ].map(({ view, icon, label }) => (
                      <Button
                        key={view}
                        variant={learningView === view ? 'default' : 'ghost'}
                        size="sm"
                        className="w-full justify-start text-sm"
                        onClick={() => onLearningNavigate && onLearningNavigate(view)}
                        data-testid={`learning-nav-${view}`}
                      >
                        {icon} <span className="ml-2">{label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-muted-foreground text-xs">
              {/* Collapsed state - icons only */}
            </div>
          )}
        </div>

        {/* Toggle Button */}
        <div className="p-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onToggle}
          >
            {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </Button>
        </div>
      </aside>
    </>
  );
}
