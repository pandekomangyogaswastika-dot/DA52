/**
 * UnifiedHeader.jsx
 * Top header bar for Collaboration Portal
 * Contains: Portal title, search, notifications, user menu
 */

import { Button } from '@/components/ui/button';
import { 
  Search, Bell, Menu, ChevronDown, LogOut, Settings, User,
  Command
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

const TAB_TITLES = {
  communication: 'Communication',
  workspace: 'Workspace',
  learning: 'Learning',
};

export default function UnifiedHeader({
  activeTab,
  user,
  notificationCount = 0,
  onSearchOpen,
  onMenuToggle,
  onLogout,
  onNotificationOpen,
}) {
  return (
    <header className="h-14 border-b bg-card flex items-center justify-between px-4 gap-4 shrink-0">
      {/* Left: Menu toggle + Title */}
      <div className="flex items-center gap-3">
        <Button 
          variant="ghost" 
          size="sm" 
          className="md:hidden"
          onClick={onMenuToggle}
        >
          <Menu size={20} />
        </Button>
        
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            🚀 Portal Kolaborasi
          </h1>
          <p className="text-xs text-muted-foreground hidden sm:block">
            {TAB_TITLES[activeTab] || activeTab}
          </p>
        </div>
      </div>

      {/* Right: Search + Notifications + User */}
      <div className="flex items-center gap-2">
        {/* Search Button */}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 hidden sm:flex"
          onClick={onSearchOpen}
        >
          <Search size={16} />
          <span className="text-muted-foreground">Search...</span>
          <kbd className="ml-2 pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <Command size={10} />K
          </kbd>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          onClick={onSearchOpen}
        >
          <Search size={20} />
        </Button>

        {/* Notifications */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="relative"
          data-testid="notification-bell"
          onClick={onNotificationOpen}
        >
          <Bell size={20} />
          {notificationCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
            >
              {notificationCount > 9 ? '9+' : notificationCount}
            </Badge>
          )}
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User size={16} className="text-primary" />
              </div>
              <span className="hidden md:inline">{user?.name || 'User'}</span>
              <ChevronDown size={16} className="hidden md:inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{user?.name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{user?.email || ''}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User size={14} className="mr-2" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings size={14} className="mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut size={14} className="mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
