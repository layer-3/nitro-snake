/**
 * Generates a random SHA256-like string to use as a room ID
 * This is a simplified version for demo purposes. In production, 
 * you might want to use a more secure random generator.
 */
export function generateRoomId(): string {
  const chars = 'abcdef0123456789';
  let result = '';
  const length = 64; // SHA256 length
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

/**
 * Shortens a room ID for display purposes
 */
export function shortenRoomId(roomId: string): string {
  if (!roomId || roomId.length < 8) return roomId;
  return `${roomId.substring(0, 6)}...${roomId.substring(roomId.length - 6)}`;
}

/**
 * Validates a room ID format (simplified check)
 */
export function isValidRoomId(roomId: string): boolean {
  // Simple check for hex string of correct length
  return /^[a-f0-9]{64}$/.test(roomId);
}

/**
 * Generates a random color for a player
 */
export function generatePlayerColor(): string {
  const colors = [
    '#3498db', // Blue
    '#2ecc71', // Green
    '#e74c3c', // Red
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Teal
    '#d35400', // Pumpkin
    '#2c3e50', // Dark Blue
  ];
  
  return colors[Math.floor(Math.random() * colors.length)];
}