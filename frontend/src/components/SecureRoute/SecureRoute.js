import React, { useState } from 'react';
import { useNavigate } from "react-router";
import { useAuth } from '../../config/auth';
import LoginModal from '../LoginModal/LoginModal';
const SecureRoute = ({ children }) => {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(true);
  const navigate = useNavigate();

  if (user) return children;
  return (
    <>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-300 text-sm">Sign in to access this page</p>
      </div>
      {showModal && (
        <LoginModal
          onSuccess={() => setShowModal(false)}
          onClose={() => {
            setShowModal(false);
            navigate(-1);
          }}
        />
      )}
    </>
  );
};

export default SecureRoute;