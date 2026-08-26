import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/nht_washing/Dashboard'
// import Register from './components/Register/Register';
// import History from './pages/nht_washing/History';
import MachineValidate from './pages/nht_washing/MachineValidate';
// import ReaderStatus from './pages/nht_washing/ReaderStatus'
import Location from './pages/nht_washing/Location';
import TagSearch from './pages/nht_washing/TagSearch';
import MbrMonitor from './pages/nht_washing/MbrMonitor';
import MultiRegister from './pages/nht_washing/MultiRegister';
import ReaderConfig from './pages/nht_washing/ReaderConfig';
import { loadLocationPorts } from './config/instance';
// import Login from './components/Login/Login';
import { AuthProvider } from './config/auth';
import SecureRoute from './components/SecureRoute';
import Management from './pages/nht_washing/Management';

function App() {
  useEffect(() => {
    loadLocationPorts();
    // set default allowed path ตอนเปิดเว็บครั้งแรก
    if (!sessionStorage.getItem('allowed_path')) {
      sessionStorage.setItem('allowed_path', '/location-reader');
    }
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>

            {/* เข้า "/" redirect ไป "/location-reader" อัตโนมัติ */}
            {/* <Route index element={<Navigate to="/dashboard" replace />} /> */}
            {/* <Route index element={<Navigate to="/register" replace />} /> */}
            {/* <Route index element={<Navigate to="/multi-register" replace />} /> */}
            {/* <Route path="register" element={<Register />} /> */}
            <Route index element={<Navigate to="/location-reader" replace />} />
            <Route path="dashboard" element={<SecureRoute><Dashboard /></SecureRoute>} />
            <Route path="multi-register" element={<SecureRoute><MultiRegister /></SecureRoute>} />
            {/* <Route path="history" element={
                <SecureRoute><History /></SecureRoute>
              } /> */}
            <Route path="machine-validation" element={<SecureRoute><MachineValidate /></SecureRoute>} />
            {/* <Route path="reader-status" element={
                <SecureRoute><ReaderStatus /></SecureRoute>
              } /> */}
            <Route path="location-reader" element={<SecureRoute><Location /></SecureRoute>} />
            <Route path="tag-search" element={<SecureRoute><TagSearch /></SecureRoute>} />
            <Route path="mbr-monitor" element={<SecureRoute><MbrMonitor /></SecureRoute>} />
            <Route path="/management" element={
              <SecureRoute requireAuth><Management /></SecureRoute>
            } />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;