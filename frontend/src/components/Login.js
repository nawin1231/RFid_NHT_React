// import React, { useState } from 'react';
// import { backendApi } from '../../config/instance';
// import { saveOperator } from '../../config/auth';
// import Swal from 'sweetalert2';
// import { ControlOutlined } from '@ant-design/icons';

// const showAlert = (msg, type) => {
//     Swal.fire({
//         toast:             false,
//         position:          'center',
//         icon:              type,
//         title:             msg,
//         showConfirmButton: false,
//         timer:             1000,
//     });
// };

// const Login = () => {

//     const [empCode, setEmpCode] = useState('');
//     const [loading, setLoading] = useState(false);

//     const handleLogin = async () => {
//         if (!empCode.trim()) {
//             showAlert('Please enter employee code!', 'warning');
//             return;
//         }

//         setLoading(true);

//         try {
//             const res = await backendApi.post('/login', {
//                 emp_code: empCode.trim()
//             });

//             if (res.data.success) {
//                 saveOperator({
//                     emp_code: res.data.emp_code,
//                     name:     res.data.name,
//                     position: res.data.position,
//                 });
//                 window.location.reload();
//             } else {
//                 showAlert('Employee not found!', 'error');
//                 setEmpCode('');
//             }

//         } catch (err) {
//             showAlert(err.message, 'error');
//         } finally {
//             setLoading(false);
//         }
//     };

//     return (
//         <div className="min-h-screen flex">

//             {/* ── ซ้าย — แถบสี ──────────────────────────────────────── */}
//             <div className="hidden lg:flex lg:w-1/2 bg-blue-400 flex-col items-center justify-center p-16 gap-8">

//                 {/* icon */}
//                 <div className="w-24 h-24 bg-white/10 rounded-3xl flex items-center justify-center">
//                     <ControlOutlined style={{ fontSize: '32px', color: 'white' }} />
//                 </div>

//                 {/* ชื่อระบบ */}
//                 <div className="text-center">
//                     <p className="text-white text-3xl font-semibold">
//                         RFID Bearing System
//                     </p>
//                     <p className="text-white/60 text-base mt-2">
//                         NHT Washing Process
//                     </p>
//                 </div>

//                 {/* info card
//                 <div className="bg-white/10 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
//                     {[
//                         { icon: '🔵', label: 'Register',           desc: 'Scan barcode & tag'     },
//                         { icon: '🟡', label: 'Washing',            desc: 'Track tray process'      },
//                         { icon: '🟢', label: 'Machine Validation', desc: 'Match part to machine'   },
//                     ].map((item) => (
//                         <div key={item.label} className="flex items-center gap-3">
//                             <span className="text-xl">{item.icon}</span>
//                             <div>
//                                 <p className="text-white text-sm font-medium">{item.label}</p>
//                                 <p className="text-white/50 text-xs">{item.desc}</p>
//                             </div>
//                         </div>
//                     ))}
//                 </div> */}

//             </div>

//             {/* ── ขวา — form ────────────────────────────────────────── */}
//             <div className="flex-1 bg-gray-50 flex flex-col items-center justify-center p-8">

//                 <div className="w-full max-w-sm flex flex-col gap-6">

//                     {/* header */}
//                     <div>
//                         <p className="text-2xl font-semibold text-gray-800">
//                             Welcome
//                         </p>
//                         <p className="text-sm text-gray-400 mt-1">
//                             Sign in with your employee code
//                         </p>
//                     </div>

//                     {/* form card */}
//                     <div className="bg-white border border-gray-100 rounded-2xl p-8 flex flex-col gap-5">

//                         {/* input */}
//                         <div className="flex flex-col gap-2">
//                             <label className="text-xs text-gray-400 uppercase tracking-wider">
//                                 Employee code
//                             </label>
//                             <input
//                                 type="text"
//                                 value={empCode}
//                                 onChange={(e) => setEmpCode(e.target.value.toUpperCase())}
//                                 onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
//                                 placeholder="Please enter you employee code"
//                                 disabled={loading}
//                                 autoFocus
//                                 className="uppercase h-12 px-4 text-sm border border-gray-200 rounded-xl
//                                            bg-gray-50 text-gray-800 placeholder-gray-300
//                                            focus:outline-none focus:ring-2 focus:ring-blue-400
//                                            disabled:opacity-50"
//                             />
//                         </div>

//                         {/* button */}
//                         <button
//                             onClick={handleLogin}
//                             disabled={loading}
//                             className="h-12 text-sm rounded-xl bg-blue-400 text-white font-medium
//                                        hover:bg-blue-800 disabled:opacity-50 transition-colors"
//                         >
//                             {loading ? 'Signing in...' : 'Sign in'}
//                         </button>

//                     </div>

//                     {/* footer */}
//                     <p className="text-xs text-gray-300 text-center">
//                        © 2026 Developed by NHT BEARING
//                     </p>

//                 </div>

//             </div>

//         </div>
//     );
// };

// export default Login;