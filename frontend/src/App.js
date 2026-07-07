import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Dashboard from './components/Dashboard/Dashboard';
// import Register from './components/Register/Register';
import History from './components/History/History';
import MachineValidate from './components/MachineValidate/MachineValidate';
import Washing from './components/Washing/Washing'
import OnMachine from './components/OnMachine/OnMachine';
import Pallet from './components/Pallet/Pallet';
import ReaderStatus from './components/ReaderStatus/ReaderStatus'
import Location from './components/Location/Location';
import TagSearch from './components/TagSearch/TagSearch';
import MbrMonitor from './components/MbrMonitor/MbrMonitor';
import MultiRegister from './components/MultiRegister/MultiRegister';
import ReaderConfig from './components/ReaderConfig/ReaderConfig';
import { loadLocationPorts } from './config/instance';
// import Login from './components/Login/Login';
// import {isLoggedIn} from'./config/auth';

function App() {
  useEffect(() => {
    loadLocationPorts();
  }, []);

  // if (!isLoggedIn()) return <Login />;

  return (

    <BrowserRouter>
      <Routes>
        {/* Route หลัก — Layout เป็นกรอบคงที่ */}
        <Route path="/" element={<Layout />}>

          {/* เข้า "/" redirect ไป "/dashboard" อัตโนมัติ */}
          {/* <Route index element={<Navigate to="/dashboard" replace />} /> */}
          {/* <Route index element={<Navigate to="/register" replace />} /> */}
          <Route index element={<Navigate to="/multi-register" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          {/* <Route path="register" element={<Register />} /> */}
          <Route path="history" element={<History />} />
          <Route path="machine-validation" element={<MachineValidate />} />
          <Route path="washing" element={<Washing />} />
          <Route path="on-machine" element={<OnMachine />} />
          <Route path="pallet" element={<Pallet />} />
          <Route path="reader-status" element={<ReaderStatus/>}/>
          <Route path="location-reader" element={<Location/>}/>
          <Route path="tag-search" element={<TagSearch />}/>
          <Route path="mbr-monitor" element={<MbrMonitor/>} />
          <Route path="multi-register" element={<MultiRegister/>}/>
          <Route path="reader-config" element={<ReaderConfig/>}/>

        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;