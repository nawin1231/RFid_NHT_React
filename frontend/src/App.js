import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Dashboard from './components/Dashboard/Dashboard';
import Register from './components/Register/Register';
import History from './components/History/History';
import MachineValidate from './components/MachineValidate/MachineValidate';
import Washing from './components/Washing/Washing'
import OnMachine from './components/OnMachine/OnMachine';
import Pallet from './components/Pallet/Pallet';
// import Login from './components/Login/Login';
// import {isLoggedIn} from'./config/auth';

function App() {

  // if (!isLoggedIn()) return <Login />;

  return (

    <BrowserRouter>
      <Routes>
        {/* Route หลัก — Layout เป็นกรอบคงที่ */}
        <Route path="/" element={<Layout />}>

          {/* เข้า "/" redirect ไป "/dashboard" อัตโนมัติ */}
          {/* <Route index element={<Navigate to="/dashboard" replace />} /> */}
          <Route index element={<Navigate to="/register" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="register" element={<Register />} />
          <Route path="history" element={<History />} />
          <Route path="machine-validation" element={<MachineValidate />} />
          <Route path="washing" element={<Washing />} />
          <Route path="on-machine" element={<OnMachine />} />
          <Route path="pallet" element={<Pallet />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;