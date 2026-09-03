-- The machine's MAC address, reported by the agent.
--
-- machine_label is the Windows computer name, which is not enough to find a PC
-- in a รพ.สต. that has several. The IP is deliberately not recorded: a DHCP
-- lease moves, so an address stored today misidentifies the machine tomorrow.
ALTER TABLE agent_installations ADD COLUMN mac_address VARCHAR(17) NULL;
