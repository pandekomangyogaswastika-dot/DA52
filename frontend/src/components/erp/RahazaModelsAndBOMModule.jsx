/**
 * RahazaModelsAndBOMModule — Combined Module (Task 1.3 + Phase 5b)
 * Menggabungkan Master Model + BOM + Size Matrix dalam satu tampilan bertab.
 * Phase 5b: Upgrade BOM dengan multi-version support.
 */
import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Shirt, ListTree, Ruler } from 'lucide-react';
import RahazaModelsModule from './RahazaModelsModule';
import RahazaBOMModuleV2 from './RahazaBOMModuleV2';
import RahazaSizesModule from './RahazaSizesModule';

export default function RahazaModelsAndBOMModule({ token, user, headers, userRole, hasPerm, onNavigate, moduleId }) {
  // Allow deep linking via sessionStorage (set by redirect from prod-models, prod-bom, prod-sizes)
  const getInitialTab = () => {
    const stored = sessionStorage.getItem('models_bom_tab');
    if (stored && ['models', 'bom', 'sizes'].includes(stored)) {
      sessionStorage.removeItem('models_bom_tab');
      return stored;
    }
    return 'models';
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  return (
    <div className="space-y-4" data-testid="models-bom-module">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Master Produk & BOM</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Kelola model produk, BOM (Bill of Material), dan ukuran (size matrix) dalam satu tempat.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="models" className="flex items-center gap-1.5" data-testid="tab-models">
            <Shirt className="w-3.5 h-3.5" />
            Master Model
          </TabsTrigger>
          <TabsTrigger value="bom" className="flex items-center gap-1.5" data-testid="tab-bom">
            <ListTree className="w-3.5 h-3.5" />
            BOM
          </TabsTrigger>
          <TabsTrigger value="sizes" className="flex items-center gap-1.5" data-testid="tab-sizes">
            <Ruler className="w-3.5 h-3.5" />
            Size Matrix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-4">
          <RahazaModelsModule
            token={token}
            user={user}
            headers={headers}
            userRole={userRole}
            hasPerm={hasPerm}
            onNavigate={onNavigate}
          />
        </TabsContent>

        <TabsContent value="bom" className="mt-4">
          <RahazaBOMModuleV2
            token={token}
            user={user}
            headers={headers}
            userRole={userRole}
            hasPerm={hasPerm}
            onNavigate={onNavigate}
          />
        </TabsContent>

        <TabsContent value="sizes" className="mt-4">
          <RahazaSizesModule
            token={token}
            user={user}
            headers={headers}
            userRole={userRole}
            hasPerm={hasPerm}
            onNavigate={onNavigate}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
