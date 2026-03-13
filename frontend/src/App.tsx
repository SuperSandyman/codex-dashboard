import { DashboardLayout } from './features/dashboard/DashboardLayout';
import { useDashboardController } from './features/dashboard/useDashboardController';

/**
 * ダッシュボードのエントリポイント。
 */
const App = () => {
  const controller = useDashboardController();

  return <DashboardLayout controller={controller} />;
};

export default App;
