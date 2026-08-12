#!/usr/bin/env node

// Consensus Verification Tool for Multi-Server Distributed PBFT
const fs = require('fs');
const axios = require('axios');
const graph = require('./helper_modules/graph.js');

async function collectNodeData() {
  const nodeData = [];
  const nodes = graph.nodeIPsArray;
  
  console.log(`Querying ${nodes.length} nodes across cluster...`);
  
  for (const nodeObj of nodes) {
    const nodeId = Object.keys(nodeObj)[0];
    const { ip, port } = nodeObj[nodeId];
    
    try {
      const commitResponse = await axios.get(`http://${ip}:${port}/api/pbft-commit-log`, { timeout: 4000 });
      const logResponse = await axios.get(`http://${ip}:${port}/api/pbft-log`, { timeout: 4000 });
      
      nodeData.push({
        port,
        ip,
        nodeId,
        commits: commitResponse.data || [],
        logs: logResponse.data || [],
        status: 'running'
      });
    } catch (error) {
      nodeData.push({
        port,
        ip,
        nodeId,
        commits: [],
        logs: [],
        status: 'failed'
      });
    }
  }
  
  return nodeData;
}

function loadTestMetadata() {
  try {
    const metadata = JSON.parse(fs.readFileSync('test-metadata.json', 'utf8'));
    return metadata;
  } catch (error) {
    return { count: 1, submittedValues: [100] };
  }
}

function loadByzantineConfig() {
  try {
    const config = require('./byzantine-config.js');
    return config;
  } catch (error) {
    return {};
  }
}

function filterHonestNodes(nodeData, byzantineConfig) {
  return nodeData.filter(node => {
    const behavior = byzantineConfig[node.nodeId];
    return !behavior || behavior === 'honest';
  });
}

function verifyAgreement(honestNodes, testData) {
  if (honestNodes.length === 0) {
    return { passed: false, details: "No honest nodes found" };
  }
  
  const commitSequences = honestNodes.map(node => 
    node.commits.slice(-testData.count).map(tx => tx.value)
  );
  
  const minLength = Math.min(...commitSequences.map(seq => seq.length));
  
  if (minLength === 0) {
    return { passed: false, details: "No transactions committed by honest nodes" };
  }
  
  const commonPrefixes = commitSequences.map(seq => seq.slice(0, minLength));
  const referencePrefix = JSON.stringify(commonPrefixes[0]);
  const identical = commonPrefixes.every(prefix => 
    JSON.stringify(prefix) === referencePrefix
  );
  
  const completionCounts = commitSequences.map(seq => seq.length);
  const allComplete = completionCounts.every(count => count === testData.count);
  
  return {
    passed: identical,
    details: identical 
      ? `All ${honestNodes.length} responding honest nodes have identical transaction order${allComplete ? '' : ` (comparing first ${minLength} transactions)`}`
      : `Disagreement found among honest nodes in transaction order`
  };
}

async function main() {
  try {
    console.log('=== PBFT Cluster Consensus Verification ===');
    
    const testData = loadTestMetadata();
    const byzantineConfig = loadByzantineConfig();
    const nodeData = await collectNodeData();
    
    const runningNodes = nodeData.filter(node => node.status === 'running');
    const honestNodes = filterHonestNodes(runningNodes, byzantineConfig);
    
    console.log(`\nCluster Status: ${runningNodes.length}/${nodeData.length} nodes running (${honestNodes.length} honest)\n`);
    
    const agreement = verifyAgreement(honestNodes, testData);
    
    console.log(`${agreement.passed ? '✅' : '❌'} Agreement: ${agreement.passed ? 'PASS' : 'FAIL'}`);
    console.log(`   ${agreement.details}`);
    
    console.log(`\nSample Node Commit State:`);
    runningNodes.slice(0, 8).forEach(node => {
      const values = node.commits.slice(-testData.count).map(tx => tx.value);
      console.log(`   🟢 ${node.nodeId} (${node.ip}:${node.port}): [${values.join(', ')}] (${node.commits.length} total commits)`);
    });
    if (runningNodes.length > 8) {
      console.log(`   ... and ${runningNodes.length - 8} more nodes`);
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Consensus: ${agreement.passed ? '✅ PASS' : '❌ FAIL'}`);
    
    process.exit(agreement.passed ? 0 : 1);
  } catch (error) {
    console.error(`❌ Verification error: ${error.message}`);
    process.exit(2);
  }
}

main();