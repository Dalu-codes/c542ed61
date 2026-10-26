import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DayPage } from "./pages/Day";
import { MethodPage } from "./pages/Method";
import { MonthPage } from "./pages/Month";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><MonthPage /></Layout>} />
      <Route path="/day/:date" element={<Layout><DayPage /></Layout>} />
      <Route path="/method" element={<Layout toolbar={false}><MethodPage /></Layout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
