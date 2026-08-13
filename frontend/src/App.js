import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/nht_washing/Dashboard'
// import Register from './components/Register/Register';
import History from './pages/nht_washing/History';
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
import SecureRoute from './components/SecureRoute/SecureRoute';

function App() {
  useEffect(() => {
    loadLocationPorts();
  }, []);

  // if (!isLoggedIn()) return <Login />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Route หลัก — Layout เป็นกรอบคงที่ */}
          <Route path="/" element={<Layout />}>

            {/* เข้า "/" redirect ไป "/dashboard" อัตโนมัติ */}
            {/* <Route index element={<Navigate to="/dashboard" replace />} /> */}
            {/* <Route index element={<Navigate to="/register" replace />} /> */}
            {/* <Route index element={<Navigate to="/multi-register" replace />} /> */}
            {/* <Route path="register" element={<Register />} /> */}
            <Route index element={<Navigate to="/location-reader" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="multi-register" element={<MultiRegister />} />
            <Route path="history" element={
              <SecureRoute><History /></SecureRoute>
            } />
            <Route path="machine-validation" element={<MachineValidate />} />
            {/* <Route path="reader-status" element={
              <SecureRoute><ReaderStatus /></SecureRoute>
            } /> */}
            <Route path="location-reader" element={<Location />} />
            <Route path="tag-search" element={<TagSearch />} />
            <Route path="mbr-monitor" element={<MbrMonitor />} />
            <Route path="/reader-config" element={
              <SecureRoute><ReaderConfig /></SecureRoute>
            } />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;