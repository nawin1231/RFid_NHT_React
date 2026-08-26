import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuth } from '../config/auth';
import LoginModal from './LoginModal';

const SecureRoute = ({ children, requireAuth = false }) => {
    const { user } = useAuth();
    const [showModal, setShowModal] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();

    // ป้องกันพิมพ์ URL ตรง
    useEffect(() => {
        const allowed = sessionStorage.getItem('allowed_path') || '/location-reader';
        if (location.pathname !== allowed && !(requireAuth)) {
            navigate(allowed, { replace: true });
        }
    }, [location.pathname]);
    useEffect(() => {
        if (requireAuth && !user) {
            setShowModal(true);
        }
    }, [location.pathname]);

    // ถ้าต้อง login และยังไม่ได้ login
    if (requireAuth && !user) {
        return (
            <>
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-gray-300 text-sm">Sign in to access this page</p>
                </div>
                {showModal && (
                    <LoginModal
                        onSuccess={() => setShowModal(false)}
                        onClose={() => {
                            const prev = sessionStorage.getItem('prev_path') || '/location-reader';
                            sessionStorage.setItem('allowed_path', prev);
                            setShowModal(false);
                            navigate(prev, { replace: true });
                        }}
                    />
                )}
            </>
        );
    }

    return children;
};

export default SecureRoute;