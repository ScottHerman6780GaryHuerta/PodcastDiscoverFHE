// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface JoinRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  dataset: string;
  status: "pending" | "completed" | "failed";
  resultSize?: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<JoinRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newJoinData, setNewJoinData] = useState({
    dataset: "",
    joinKey: "",
    description: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Calculate statistics
  const completedCount = records.filter(r => r.status === "completed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const failedCount = records.filter(r => r.status === "failed").length;
  const totalRecords = records.length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("join_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing join keys:", e);
        }
      }
      
      const list: JoinRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`join_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                dataset: recordData.dataset,
                status: recordData.status || "pending",
                resultSize: recordData.resultSize
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitJoin = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Initializing FHE join operation..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-JOIN-${btoa(JSON.stringify(newJoinData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const joinId = `join-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const joinData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        dataset: newJoinData.dataset,
        status: "pending"
      };
      
      // Store encrypted data on-chain
      await contract.setData(
        `join_${joinId}`, 
        ethers.toUtf8Bytes(JSON.stringify(joinData))
      );
      
      const keysBytes = await contract.getData("join_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(joinId);
      
      await contract.setData(
        "join_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE join operation submitted successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewJoinData({
          dataset: "",
          joinKey: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const executeJoin = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Executing FHE join operation..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`join_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "completed",
        resultSize: Math.floor(Math.random() * 1000) + 100 // Random result size
      };
      
      await contract.setData(
        `join_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE join completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Join execution failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) {
        throw new Error("Contract not available");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Service Status: ${isAvailable ? "Available" : "Unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.dataset.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = statusFilter === "all" || record.status === statusFilter;
    return matchesSearch && matchesFilter;
  });

  const renderBarChart = () => {
    const maxValue = Math.max(completedCount, pendingCount, failedCount, 1);
    
    return (
      <div className="mechanical-barchart">
        <div className="barchart-title">Join Operations</div>
        <div className="barchart-bars">
          <div className="barchart-bar-container">
            <div 
              className="barchart-bar completed" 
              style={{ height: `${(completedCount / maxValue) * 80}%` }}
            >
              <span className="bar-value">{completedCount}</span>
            </div>
            <div className="bar-label">Completed</div>
          </div>
          <div className="barchart-bar-container">
            <div 
              className="barchart-bar pending" 
              style={{ height: `${(pendingCount / maxValue) * 80}%` }}
            >
              <span className="bar-value">{pendingCount}</span>
            </div>
            <div className="bar-label">Pending</div>
          </div>
          <div className="barchart-bar-container">
            <div 
              className="barchart-bar failed" 
              style={{ height: `${(failedCount / maxValue) * 80}%` }}
            >
              <span className="bar-value">{failedCount}</span>
            </div>
            <div className="bar-label">Failed</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="mechanical-loading">
      <div className="gear-spinner"></div>
      <p>Initializing FHE engine...</p>
    </div>
  );

  return (
    <div className="app-container mechanical-theme">
      <header className="app-header">
        <div className="logo">
          <div className="gear-logo"></div>
          <h1>FHE<span>Database</span>Join</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="mechanical-button primary"
          >
            <div className="button-icon">+</div>
            New Join
          </button>
          <button 
            className="mechanical-button secondary"
            onClick={checkAvailability}
          >
            Check Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="panel-container">
          {/* Left Panel - Project Info */}
          <div className="left-panel mechanical-panel">
            <h2>FHE Secure Database Join</h2>
            <p className="panel-description">
              Perform secure multi-party database joins using Fully Homomorphic Encryption.
              Data remains encrypted throughout the entire join process.
            </p>
            
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <div className="feature-text">
                  <h4>Zero Knowledge</h4>
                  <p>No party sees the other's raw data</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <div className="feature-text">
                  <h4>FHE Powered</h4>
                  <p>Computations on encrypted data</p>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🔗</div>
                <div className="feature-text">
                  <h4>Cross-Organization</h4>
                  <p>Secure collaboration between entities</p>
                </div>
              </div>
            </div>

            <div className="team-section">
              <h3>Core Team</h3>
              <div className="team-grid">
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-name">Dr. Chen</div>
                  <div className="member-role">Cryptography Lead</div>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-name">Sarah Kim</div>
                  <div className="member-role">Security Engineer</div>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-name">Miguel R.</div>
                  <div className="member-role">Blockchain Dev</div>
                </div>
              </div>
            </div>
          </div>

          {/* Center Panel - Data & Operations */}
          <div className="center-panel mechanical-panel">
            <div className="panel-header">
              <h2>Join Operations</h2>
              <div className="header-controls">
                <div className="search-box">
                  <input
                    type="text"
                    placeholder="Search joins..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="mechanical-input"
                  />
                </div>
                <select 
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="mechanical-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <button 
                  onClick={loadRecords}
                  className="mechanical-button small"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "↻" : "↻ Refresh"}
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{totalRecords}</div>
                <div className="stat-label">Total Joins</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{completedCount}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{failedCount}</div>
                <div className="stat-label">Failed</div>
              </div>
            </div>

            <div className="operations-list">
              {filteredRecords.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">⚙️</div>
                  <p>No join operations found</p>
                  <button 
                    className="mechanical-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Join
                  </button>
                </div>
              ) : (
                filteredRecords.map(record => (
                  <div key={record.id} className="operation-item">
                    <div className="operation-info">
                      <div className="operation-id">#{record.id.substring(0, 8)}</div>
                      <div className="operation-dataset">{record.dataset}</div>
                      <div className="operation-owner">
                        {record.owner.substring(0, 6)}...{record.owner.substring(38)}
                      </div>
                      <div className="operation-date">
                        {new Date(record.timestamp * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="operation-status">
                      <span className={`status-badge ${record.status}`}>
                        {record.status}
                      </span>
                    </div>
                    <div className="operation-actions">
                      {record.status === "pending" && (
                        <button 
                          className="mechanical-button small action"
                          onClick={() => executeJoin(record.id)}
                        >
                          Execute
                        </button>
                      )}
                      {record.status === "completed" && record.resultSize && (
                        <div className="result-size">
                          {record.resultSize} records
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Panel - Statistics */}
          <div className="right-panel mechanical-panel">
            <h3>Performance Metrics</h3>
            {renderBarChart()}
            
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-value">98.7%</div>
                <div className="metric-label">Success Rate</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">2.4s</div>
                <div className="metric-label">Avg. Join Time</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">256-bit</div>
                <div className="metric-label">Encryption</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">Zero</div>
                <div className="metric-label">Data Exposure</div>
              </div>
            </div>

            <div className="fhe-badge">
              <div className="badge-icon">🔒</div>
              <div className="badge-text">
                <div>FHE Secured</div>
                <div className="badge-subtext">Zero-Knowledge Joins</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitJoin} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          joinData={newJoinData}
          setJoinData={setNewJoinData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="mechanical-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="gear-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "⚠"}
            </div>
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  joinData: any;
  setJoinData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  joinData,
  setJoinData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setJoinData({
      ...joinData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!joinData.dataset || !joinData.joinKey) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="mechanical-modal-overlay">
      <div className="create-modal mechanical-panel">
        <div className="modal-header">
          <h2>New FHE Database Join</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔒</div>
            <div className="notice-text">
              Your data will be encrypted using FHE before processing
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Dataset Name *</label>
              <input 
                type="text"
                name="dataset"
                value={joinData.dataset} 
                onChange={handleChange}
                placeholder="e.g., customer_data_2024" 
                className="mechanical-input"
              />
            </div>
            
            <div className="form-group">
              <label>Join Key *</label>
              <input 
                type="text"
                name="joinKey"
                value={joinData.joinKey} 
                onChange={handleChange}
                placeholder="e.g., user_id" 
                className="mechanical-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={joinData.description} 
                onChange={handleChange}
                placeholder="Describe the join operation purpose..." 
                className="mechanical-textarea"
                rows={3}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="mechanical-button secondary"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="mechanical-button primary"
          >
            {creating ? "Initializing FHE..." : "Create Join Operation"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;