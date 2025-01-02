// SPDX-License-Identifier: Leluk911

pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/interfaces/IERC1155.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./interface/Ibond.sol";

import {console} from "hardhat/console.sol";

contract UpwardAuction is
    ERC165,
    Pausable,
    ReentrancyGuard,
    Ownable,
    IERC1155Receiver
{
    address internal bondContract;
    address internal money; // da decidere se weth o usdc
    uint internal constant minPeriodAuction = 7 days;
    uint internal contractBalance;
    uint internal coolDown;

    constructor(
        address _bondContrac,
        address _money,
        uint _fixedFee,
        uint _priceThreshold,
        uint _dinamicFee
    ) Ownable(msg.sender) {
        bondContract = _bondContrac;
        money = _money;

        feeSystem.fixedFee = _fixedFee;
        feeSystem.priceThreshold = _priceThreshold;
        feeSystem.dinamicFee = _dinamicFee;
    }

    struct Auction {
        address owner;
        uint id;
        uint amount;
        uint startPrice;
        uint expired;
        uint pot;
        address player;
        bool open;
    }
    struct FeeSystem {
        uint fixedFee;
        uint priceThreshold;
        uint dinamicFee;
    }
    struct FeeSeller {
        uint[] echelons;
        uint[] fees;
    }
    FeeSeller internal feeSeller;
    FeeSystem internal feeSystem;
    Auction[] internal auctions;

    mapping(address => uint) balanceUser; // non mi convince
    mapping(address => uint) lockBalance;
    mapping(address => mapping(uint => uint)) internal lastPotTime;

    event NewAuction(address indexed _owner, uint indexed _id, uint _amount);
    event newInstalmentPot(
        address indexed _player,
        uint indexed _index,
        uint _amountPot
    );
    event CloseAuction(uint _index, uint _time);
    event WithDrawBond(
        address indexed _user,
        uint indexed _index,
        uint indexed amount
    );
    event WithDrawMoney(address indexed _user, uint indexed amount);
    event PaidFee(uint _amount);

    modifier outIndex(uint _index) {
        require(_index < auctions.length, "digit correct index for array");
        _;
    }
    function showAuctionsList() virtual public view returns (Auction[] memory) {
        return auctions;
    }
    function showAuction(uint _index) virtual public view returns (Auction memory) {
        return auctions[_index];
    }
    function setFeeSeller(
        uint[] memory _echelons,
        uint[] memory _fees
    )virtual external onlyOwner nonReentrant {
        feeSeller.echelons = _echelons;
        feeSeller.fees = _fees;
    }
    function newAcutionBond(
        uint _id,
        uint _amount,
        uint _startPrice,
        uint _expired
    )virtual external nonReentrant {
        require(_amount > 0, "Set correct bond's amount");
        require(_startPrice > 0, "Set correct start price");
        require(
            _expired > (block.timestamp + minPeriodAuction),
            "Set correct expired period"
        );
        _newAcutionBond(msg.sender, _id, _amount, _startPrice, _expired);
    }
    function instalmentPot(
        uint _index,
        uint _amount
    )virtual external nonReentrant outIndex(_index) {
        _instalmentPot(msg.sender, _index, _amount);
        emit newInstalmentPot(msg.sender, _index, _amount);
    }
    function closeAuction(uint _index)virtual external nonReentrant outIndex(_index) {
        _closeAuction(msg.sender, _index);
        emit CloseAuction(_index, block.timestamp);
    }
    function withDrawBond(uint _index)virtual external nonReentrant outIndex(_index) {
        _withDrawBond(msg.sender, _index);
    }
    function withdrawMoney(uint _amount)virtual external nonReentrant {
        _withdrawMoney(msg.sender, _amount);
        emit WithDrawMoney(msg.sender, _amount);
    }
    // fUNZIONI PER IL DEPOSITO
    function _newAcutionBond(
        address _user,
        uint _id,
        uint _amount,
        uint _startPrice,
        uint _expired
    ) virtual internal {
        _depositBond(_user, address(this), _id, _amount);
        _setAuctionData(_user, _id, _amount, _startPrice, _expired);
    }
    function _depositBond(
        address _user,
        address _to,
        uint _id,
        uint _amount
    )virtual internal {
        IERC1155(bondContract).safeTransferFrom(_user, _to, _id, _amount, "");
    }
    function _setAuctionData(
        address _owner,
        uint _id,
        uint _amount,
        uint _startPrice,
        uint _expired
    )virtual internal {
        Auction memory _auction = Auction(
            _owner,
            _id,
            _amount,
            _startPrice,
            _expired,
            0,
            _owner,
            true
        );
        auctions.push(_auction);
        emit NewAuction(_owner, _id, _amount);
    }
    // funzioni per puntare
    function _instalmentPot(
        address _player,
        uint _index,
        uint _amount
    )virtual internal {
        require(
            auctions[_index].expired > block.timestamp,
            "This auction is expired"
        );
        require(auctions[_index].open == true, "This auction is close");
        require(
            auctions[_index].pot < _calcPotFee(_amount), //? Esiste una soluzione migliore?!
            "This pot is low then already pot"
        );
        require(auctions[_index].owner != _player, "Owner can't pot");
        coolDownControl(_player, _index);
        // deposito i token
        _depositErc20(_player, address(this), _amount);
        uint amountLessFee = _paidPotFee(_amount);
        lockBalance[_player] += amountLessFee;
        balanceUser[_player] += amountLessFee; //non mi convince
        // aggiorno i dati
        //prima devo sloccare i soldi al altro player
        lockBalance[auctions[_index].player] -= auctions[_index].pot;
        auctions[_index].player = _player;
        auctions[_index].pot = amountLessFee;
    }
    function  _calcPotFee(uint _amount)virtual internal view returns (uint) {
        if (_amount < feeSystem.priceThreshold) {
            return _amount - feeSystem.fixedFee;
        } else {
            return
                _amount - calculateBasisPoints(_amount, feeSystem.dinamicFee);
        }
    }
    function _paidPotFee(uint _amount) virtual internal returns (uint) {
        if (_amount < feeSystem.priceThreshold) {
            contractBalance += feeSystem.fixedFee;
            emit PaidFee(_amount);
            return _amount - feeSystem.fixedFee;
        } else {
            contractBalance += calculateBasisPoints(
                _amount,
                feeSystem.dinamicFee
            );
            emit PaidFee(_amount);
            return
                _amount - calculateBasisPoints(_amount, feeSystem.dinamicFee);
        }
    }
    function calculateBasisPoints(
        uint256 amount,
        uint256 bps
    ) virtual internal pure returns (uint) {
        return (amount * bps) / 10000; // 10000 bps = 100%
    }
    function _depositErc20(address _from, address _to, uint _amount) virtual internal {
        SafeERC20.safeTransferFrom(IERC20(money), _from, _to, _amount);
    }
    // funzione per chiudere l'auction alla fine del processo
    function _closeAuction(address _owner, uint _index) virtual internal {
        require(
            auctions[_index].expired < block.timestamp,
            "This auction is not expired"
        );
        require(
            _owner == auctions[_index].owner ||
                _owner == auctions[_index].player||_owner ==owner(),//? per ora lascio la possibilità al owner di forzare la chiusura di un asta per incassare le fees
            "Not Owner"
        );
        require(auctions[_index].open == true, "This auction already close");
        auctions[_index].open = false;

        address newOwner = auctions[_index].player;
        address oldOwner = auctions[_index].owner;
        uint pot = _paidSellFee(auctions[_index].pot);

        auctions[_index].pot = 0;
        auctions[_index].owner = newOwner;

        balanceUser[newOwner] -= pot;
        lockBalance[newOwner] -= pot;

        balanceUser[oldOwner] += pot;
    }
    function _paidSellFee(uint _amount) virtual internal returns (uint) {
        for (uint i; i < feeSeller.echelons.length; i++) {
            if (_amount < feeSeller.echelons[i]) {
                uint fee = calculateBasisPoints(_amount, feeSeller.fees[i]);
                contractBalance += fee;
                emit PaidFee(fee);
                return _amount - fee;
            }
        }
        uint _fee = calculateBasisPoints(
            _amount,
            feeSeller.fees[feeSeller.fees.length - 1]
        );
        contractBalance += _fee;
        emit PaidFee(_fee);
        return _amount - _fee;
    }
    function _withDrawBond(address _owner, uint _index) virtual internal {
        require(_owner == auctions[_index].owner, "Not Owner");
        require(
            auctions[_index].expired < block.timestamp,
            "This auction is not expired"
        ); // penso sia da correggere
        require(auctions[_index].open == false, "This auction is Open");

        uint amountBond = auctions[_index].amount;
        auctions[_index].amount = 0;
        _depositBond(
            address(this),
            auctions[_index].owner,
            auctions[_index].id,
            amountBond
        );
        emit WithDrawBond(
            auctions[_index].owner,
            auctions[_index].id,
            amountBond
        );
    }
    // funzione per prelevare i Money
    function _withdrawMoney(address _user, uint _amount) virtual internal {
        require(
            _amount <= balanceUser[_user] - lockBalance[_user],
            "Free balance is low for this operation"
        );
        require(
            lockBalance[_user] <= balanceUser[_user] - _amount,
            "Incorrect Operation"
        );
        balanceUser[_user] -= _amount;
        SafeERC20.safeTransfer(IERC20(money), _user, _amount);
    }
    //Freez system
    function setCoolDown(uint _coolDown) virtual external onlyOwner {
        coolDown = _coolDown;
    }
    function coolDownControl(address _user, uint _id) virtual internal {
        require(
            lastPotTime[_user][_id] + coolDown < block.timestamp,
            "Wait for pot again"
        );
        lastPotTime[_user][_id] = block.timestamp;
    }
    function showFeesSystem() virtual public view returns (FeeSystem memory) {
        return feeSystem;
    }
    function showFeesSeller() virtual public view returns (FeeSeller memory) {
        return feeSeller;
    }
    // ? Non so se la lascero ma per ora mi serve in fase di testing
    function showBalanceFee() virtual external view returns (uint) {
        return contractBalance;
    }
    function withdrawFees() virtual external onlyOwner {
        uint amount = contractBalance;
        contractBalance = 0;
        SafeERC20.safeTransfer(IERC20(money), owner(), amount);
    }
    // Funzione per ricevere singoli trasferimenti ERC1155
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external pure override returns (bytes4) {
        // Logica personalizzata (se necessaria)
        return this.onERC1155Received.selector;
    }
    // Funzione per ricevere trasferimenti batch ERC1155
    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external pure override returns (bytes4) {
        // Logica personalizzata (se necessaria)
        return this.onERC1155BatchReceived.selector;
    }
}
