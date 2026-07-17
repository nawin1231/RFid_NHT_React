import React, { createContext, useContext, useState } from 'react';
const Auth = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        const saved = sessionStorage.getItem('rfid_user');
        return saved ? JSON.parse(saved) : null;
    });

    const login = (userData) => {
        sessionStorage.setItem('rfid_user', JSON.stringify(userData));
        setUser(userData);
    };

    const logout = () => {
        sessionStorage.removeItem('rfid_user');
        setUser(null);
    };

    return (
        <Auth.Provider value={{ user, login, logout }}>
            {children}
        </Auth.Provider>
    );
};

export const useAuth = () => useContext(Auth);