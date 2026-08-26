import React from 'react';
import Swal from 'sweetalert2';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-white border-t border-gray-200 py-3 px-6 flex items-center justify-between shrink-0">

      <div className="text-xs text-gray-500 font-medium">
        &copy; {currentYear} Developed by NHT Bearing
      </div>

      <div className="flex items-center gap-4">
        <a href="/location-reader" className="text-xs text-gray-400 hover:text-blue-600 transition-colors duration-150">
          Dx Staff
        </a>
        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
        <span className="text-xs text-gray-400">Version : 1.0.0</span>
      </div>

    </footer>
  );
};

export default Footer;