'use client';

import React, { useState, useEffect } from 'react';
import type { UserProfile } from '@/types/domain';
import {
  X,
  UserCheck,
  UserPlus,
  LogIn,
  KeyRound,
  Copy,
  RefreshCw,
  Scale,
  Watch,
} from 'lucide-react';

interface ProfileAuthModalProps {
  isOpen: boolean;
  currentUser: UserProfile;
  onClose: () => void;
  onUserSwitched: (user: UserProfile) => void;
  onShowToast: (msg: string) => void;
}

export default function ProfileAuthModal({
  isOpen,
  currentUser,
  onClose,
  onUserSwitched,
  onShowToast,
}: ProfileAuthModalProps) {
  const [mode, setMode] = useState<'switch' | 'login' | 'register'>('switch');
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [bodyweightKg, setBodyweightKg] = useState(
    String(currentUser.bodyweightKg || 78.5)
  );
  const [appleFitnessEnabled, setAppleFitnessEnabled] = useState(
    currentUser.appleFitnessEnabled
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setBodyweightKg(String(currentUser.bodyweightKg || 78.5));
    setAppleFitnessEnabled(currentUser.appleFitnessEnabled);
    fetch('/api/auth?list=1')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.users)) {
          setProfiles(data.users);
        }
      })
      .catch(() => {});
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  const handleQuickSwitch = async (targetUsername: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', username: targetUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Switch failed');
      onUserSwitched(data.user);
      onShowToast(`Switched to ${data.user.displayName}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to switch profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedBw = parseFloat(bodyweightKg.replace(',', '.')) || 75;
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_profile',
          bodyweightKg: parsedBw,
          appleFitnessEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');
      onUserSwitched(data.user);
      onShowToast('Athlete settings saved!');
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          password,
          bodyweightKg: parseFloat(bodyweightKg.replace(',', '.')) || 75,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      onUserSwitched(data.user);
      onShowToast(`Welcome, ${data.user.displayName}!`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  const handleRotateApiKey = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate_api_key' }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        onUserSwitched(data.user);
        onShowToast('New MCP / Webhook API key generated!');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyApiKey = () => {
    navigator.clipboard?.writeText(currentUser.apiKey);
    onShowToast('API Key copied to clipboard!');
  };

  return (
    <div className="sheet-backdrop flex items-end sm:items-center justify-center">
      <div className="sheet-panel sm:relative sm:max-w-lg sm:rounded-[16px] sm:border-[3px] sm:border-[#1d1a16]">
        <div className="flex items-center justify-between border-b-[2.5px] border-[#1d1a16] pb-3 mb-4">
          <div>
            <h2 className="text-2xl text-[#d9412b]">ATHLETE LOCKER & AUTH</h2>
            <p className="text-sm text-[#5d5446]">
              Multi-user isolation, bodyweight calibration & MCP API key
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn icon alt"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('switch')}
            className={`btn !min-h-[44px] text-sm ${
              mode === 'switch' ? '' : 'alt'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Profiles
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`btn !min-h-[44px] text-sm ${
              mode === 'register' ? '' : 'alt'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            New Athlete
          </button>
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`btn !min-h-[44px] text-sm ${
              mode === 'login' ? '' : 'alt'
            }`}
          >
            <LogIn className="w-4 h-4" />
            Login
          </button>
        </div>

        {error && (
          <div className="card-sm !bg-[#f6cfc4] mb-3 text-sm font-bold text-[#d9412b]">
            {error}
          </div>
        )}

        {mode === 'switch' ? (
          <div className="space-y-4">
            {/* Current Athlete Calibration */}
            <div className="card-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-[#5d5446]">
                    Active Athlete
                  </span>
                  <h3 className="text-xl">{currentUser.displayName}</h3>
                </div>
                <span className="pill gold">
                  {currentUser.rankTier} • Lv.{currentUser.level}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="block">
                  <span className="text-sm font-bold flex items-center gap-1 mb-1">
                    <Scale className="w-4 h-4 text-[#d9412b]" />
                    Bodyweight (kg) — for Chin-up/Dip math
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bodyweightKg}
                    onChange={(e) => setBodyweightKg(e.target.value)}
                    className="nb-input"
                  />
                </label>

                <div className="flex flex-col justify-end">
                  <button
                    type="button"
                    onClick={() => setAppleFitnessEnabled(!appleFitnessEnabled)}
                    className={`btn !min-h-[44px] text-sm w-full ${
                      appleFitnessEnabled ? 'green' : 'alt'
                    }`}
                  >
                    <Watch className="w-4 h-4" />
                    Apple Fitness: {appleFitnessEnabled ? 'ON' : 'Hidden'}
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleUpdateProfile}
                className="btn w-full"
              >
                Save Athlete Settings
              </button>
            </div>

            {/* API Key Box */}
            <div className="card-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-[#2b5fa8]" />
                  Personal MCP & Webhook API Key
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={copyApiKey}
                    className="btn alt !min-h-[38px] !px-2.5 text-xs"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                  <button
                    type="button"
                    onClick={handleRotateApiKey}
                    className="btn alt !min-h-[38px] !px-2.5 text-xs"
                    title="Rotate API Key"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <code className="block text-xs bg-[#ece2c6] p-2 rounded border-2 border-[#1d1a16] break-all font-mono">
                {currentUser.apiKey}
              </code>
            </div>

            {/* Fast Profile Switcher List */}
            <div>
              <h3 className="text-base mb-2">
                1-Tap Gym Partner / Demo Profile Switch
              </h3>
              <div className="space-y-2">
                {profiles.map((p) => {
                  const isCurrent = p.id === currentUser.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={loading || isCurrent}
                      onClick={() => handleQuickSwitch(p.username)}
                      className={`btn w-full !justify-between ${
                        isCurrent ? 'green' : 'alt'
                      }`}
                    >
                      <span className="truncate">
                        {p.displayName} (@{p.username})
                      </span>
                      <span className="pill text-xs">
                        {isCurrent
                          ? 'Active'
                          : `${p.rankTier} Lv.${p.level} • Switch`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleAuthSubmit} className="space-y-3">
            <label className="block">
              <span className="text-sm font-bold">Username</span>
              <input
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. marco_lifts"
                className="nb-input mt-1"
              />
            </label>

            {mode === 'register' && (
              <>
                <label className="block">
                  <span className="text-sm font-bold">Display Name</span>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Marco"
                    className="nb-input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">
                    Bodyweight (kg) — used for Weighted Chin-up/Dip math
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bodyweightKg}
                    onChange={(e) => setBodyweightKg(e.target.value)}
                    className="nb-input mt-1"
                  />
                </label>
              </>
            )}

            <label className="block">
              <span className="text-sm font-bold">
                Password (optional for local gym-partner profiles)
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="nb-input mt-1"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="btn big w-full mt-2"
            >
              {mode === 'register'
                ? 'CREATE ATHLETE & SEED SPLIT'
                : 'SIGN IN TO LOCKER'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
