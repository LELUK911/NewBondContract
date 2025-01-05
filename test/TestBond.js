const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe('Test proxy Bond, stable version', () => {

    let bondContract, mockWETH, mockDai, mockBTC, owner, issuer, user1, user2,user3;
    let bondContractAddress, daiAddress, btcAddress, WETHaddress;
    let launchBondContract, launchBondContractAddress
    let upwardAuctionContract, upwardAuctionContractAddress
    let downwardAuctionContract, downwardAuctionContractAddress

    //? BOND FUNCTION
    let newBondFunction
    //? HELPER 
    let expiredCoupons, expired

    beforeEach(async () => {
        [owner, issuer, user1, user2,user3] = await ethers.getSigners();

        const BondContractFactory = await ethers.getContractFactory("BondContract");
        bondContract = await BondContractFactory.connect(owner).deploy(owner.address)
        await bondContract.waitForDeployment()
        bondContractAddress = await bondContract.getAddress()

        const LaunchBondContract = await ethers.getContractFactory('BondLaunch')
        launchBondContract = await LaunchBondContract.connect(owner).deploy(bondContractAddress)
        await launchBondContract.waitForDeployment()
        launchBondContractAddress = await launchBondContract.getAddress()

        const MockToken = await ethers.getContractFactory('MockToken');
        mockWETH = await MockToken.deploy(ethers.parseUnits('9000000000000'), 'WETH', 'WETH');
        mockDai = await MockToken.deploy(ethers.parseUnits('9000000000000'), 'Dai Token', 'DAI');
        mockBTC = await MockToken.deploy(ethers.parseUnits('9000000000000'), 'Bitcoin', 'BTC');

        await mockBTC.connect(owner).transfer(issuer.address, ethers.parseUnits('1000000000000'))
        await mockDai.connect(owner).transfer(issuer.address, ethers.parseUnits('1000000000000'))
        await mockWETH.connect(owner).transfer(issuer.address, ethers.parseUnits('1000000000000'))

        await mockWETH.waitForDeployment()
        await mockDai.waitForDeployment()
        await mockBTC.waitForDeployment()
        daiAddress = await mockDai.getAddress()
        btcAddress = await mockBTC.getAddress()
        WETHaddress = await mockWETH.getAddress()

        //? UPWARD DEPLOY AND PRELIMINAR ACTION
        const UpwardAuction = await ethers.getContractFactory('UpwardAuction')
        upwardAuctionContract = await UpwardAuction.connect(owner).deploy(
            bondContractAddress,
            daiAddress,
            ethers.parseUnits('1'),//fixed Fee 1$
            ethers.parseUnits('1000'),// price Threshold 1000$
            100 //dinamicfee 1%
        )
        await upwardAuctionContract.waitForDeployment()
        upwardAuctionContractAddress = await upwardAuctionContract.getAddress()

        const _echelons = [
            ethers.parseUnits('1000'), // value in $
            ethers.parseUnits('10000'),
            ethers.parseUnits('100000'),
            ethers.parseUnits('1000000'),
        ]
        const _fees = [
            100, 75, 50, 25 //1%,0.75%,0.5%,0.25%
        ]

        await upwardAuctionContract.connect(owner).setFeeSeller(_echelons, _fees)

        //? DOWNAUCTION DEPLOY AND PRELIMINAR ACTION
        const downwardAuction = await ethers.getContractFactory('DownwardAuction')
        downwardAuctionContract = await downwardAuction.connect(owner).deploy(
            bondContractAddress,
            daiAddress,
            ethers.parseUnits('1'),//fixed Fee 1$
            ethers.parseUnits('1000'),// price Threshold 1000$
            100 //dinamicfee 1%
        )
        await downwardAuctionContract.waitForDeployment()
        downwardAuctionContractAddress = await downwardAuctionContract.getAddress()
        await downwardAuctionContract.connect(owner).setFeeSeller(_echelons, _fees)

        //? set preliminar variable BondContract
        await bondContract.connect(owner).setMAX_COUPONS('6')
        await bondContract.connect(owner).setTransfertFee(ethers.parseUnits('0.01'))
        await bondContract.connect(owner).setlauncherContract(launchBondContractAddress)
        await bondContract.connect(owner).setlauncherContract(launchBondContractAddress)
        await bondContract.connect(owner).setWETHaddress(WETHaddress)
        await bondContract.connect(owner).setTreasuryAddress(owner.address) // Uguale all'owner per comodità nei test
        await bondContract.connect(owner).setEcosistemAddress(upwardAuctionContractAddress,true) // Uguale all'owner per comodità nei test
        await bondContract.connect(owner).setEcosistemAddress(downwardAuctionContractAddress,true) // Uguale all'owner per comodità nei test

        //***  HELPER
        expiredCoupons = async (daysList) => {
            const currentBlock = await ethers.provider.getBlock("latest");
            const currentTimestamp = currentBlock.timestamp;
            const oneDayTime = currentTimestamp + 86400;  // 1 giorno
            let couponExpired = []
            for (let index = 0; index < daysList.length; index++) {
                const element = daysList[index];
                couponExpired.push((oneDayTime * element).toString())
            }
            console.log(couponExpired)
            return couponExpired;
        }
        expired = async (days)=>{
            const currentBlock = await ethers.provider.getBlock("latest");
            const currentTimestamp = currentBlock.timestamp;
            const dayTime = currentTimestamp +( 86400*days);
            return dayTime.toString();
        }
        //***  BOND FUNCTION
        newBondFunction = async (_sizeLoan, _interest, couponMaturity, expiredBond, _collateralAmount, issuer,amount) => {
            const sizeLoan = ethers.parseUnits(_sizeLoan);
            const interest = ethers.parseUnits(_interest);
            const collateralAmount = ethers.parseUnits(_collateralAmount);
            const bondAmount = amount;
            const description = "Test bond";
            await mockBTC.connect(issuer).approve(bondContractAddress, ethers.parseUnits(_collateralAmount))

            await expect(
                bondContract.connect(issuer).createNewBond(
                    issuer.address,
                    await mockDai.getAddress(),
                    sizeLoan,
                    interest,
                    couponMaturity,
                    expiredBond,
                    await mockBTC.getAddress(),
                    collateralAmount,
                    bondAmount,
                    description
                )
            ).to.emit(bondContract, "BondCreated");
        }
        //! IL COOLDOWN NON VIENE SETTATO PER SEMPLICITÀ DEI TEST
    });
    it('deploys correctly and initializes variables', async () => {
        const bondID = await bondContract.connect(owner).viewBondID()
        const ownerAddress = await bondContract.connect(owner).owner()
        const wethAddress = await bondContract.connect(owner).showWETHaddress()
        const transferFee = await bondContract.connect(owner).showTransfertFee()
        const BondContractAddressInLauncher = await launchBondContract.connect(owner).showBondContractAddress()
        const BondContractAddressInUpwardAuction = await upwardAuctionContract.connect(owner).showBondContractAddress()
        const BondContractAddressInDownwardAuction = await downwardAuctionContract.connect(owner).showBondContractAddress()

        const echelonsControl =[
            1000000000000000000000n,
            10000000000000000000000n,
            100000000000000000000000n,
            1000000000000000000000000n
        ]
        const feeControl = [ 100n, 75n, 50n, 25n ]
        

        //UpwardAuction
        const upFeeSystem = await upwardAuctionContract.connect(owner).showFeesSystem()
        const upFeeSeller = await upwardAuctionContract.connect(owner).showFeesSeller()

        //todo controlli manuali fatti successivamente settero quelli formali

        //DownwardAuction
        const downFeeSystem = await downwardAuctionContract.connect(owner).showFeesSystem()
        const downFeeSeller = await downwardAuctionContract.connect(owner).showFeesSeller()

        //todo controlli manuali fatti successivamente settero quelli formali
        expect(await bondID.toString()).to.eq('0')
        expect(ownerAddress).to.eq(owner.address)
        expect(wethAddress).to.eq(WETHaddress)
        expect(transferFee.toString()).to.eq((ethers.parseUnits('0.01')).toString())
        expect(BondContractAddressInLauncher).to.eq(bondContractAddress)
        expect(BondContractAddressInUpwardAuction).to.eq(bondContractAddress)
        expect(BondContractAddressInDownwardAuction).to.eq(bondContractAddress)

    });
    it("Create new bonds ",async()=>{
        //? Approve spending
        await mockBTC.connect(issuer).approve(bondContractAddress,ethers.parseUnits('999999999'))
        await mockDai.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))
        await mockWETH.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))

        //? Create new Bond ( in this case all equal)
        const currentBlock = await ethers.provider.getBlock("latest");
        const currentTimestamp = currentBlock.timestamp;
        const couponMaturity = [
            currentTimestamp + (86400*10),  
            currentTimestamp + (86400*20), 
            currentTimestamp + (86400*30),
            currentTimestamp + (86400*40),  
            currentTimestamp + (86400*50), 
            currentTimestamp + (86400*60),  

        ];
        const expiredBond = currentTimestamp + (86400*90);
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100')
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100')
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100')
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100')
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100')  
    })
    it("Create new bond and launch on launcher",async()=>{
        //? Approve spending
        await mockBTC.connect(issuer).approve(bondContractAddress,ethers.parseUnits('999999999'))
        await mockDai.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))
        await mockWETH.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))

        //? Create new Bond ( in this case all equal)
        const currentBlock = await ethers.provider.getBlock("latest");
        const currentTimestamp = currentBlock.timestamp;
        const couponMaturity = [
            currentTimestamp + (86400*10),  
            currentTimestamp + (86400*20), 
            currentTimestamp + (86400*30),
            currentTimestamp + (86400*40),  
            currentTimestamp + (86400*50), 
            currentTimestamp + (86400*60),  

        ];
        const expiredBond = currentTimestamp + (86400*90);
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100') // ID 0
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100') // ID 1
        
        //? Approve launchBondContract at spending ERC1155
        await bondContract.connect(issuer).setApprovalForAll(launchBondContractAddress, true);

        //? Launch Bond ID1
        await expect(launchBondContract.connect(issuer).launchNewBond('1', '100')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        
        //? Verifies
        const bondList = await launchBondContract.connect(issuer).showBondLaunchList()
        expect(bondList[0].toString()).eq("1");
        expect(await launchBondContract.connect(owner).showAmountInSellForBond('1')).eq('100');
    })
    it("Two user buy some bond in launch",async()=>{
        //? Approve spending
        await mockBTC.connect(issuer).approve(bondContractAddress,ethers.parseUnits('999999999'))
        await mockDai.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))
        await mockWETH.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))

        //? Create new Bond ( in this case all equal)
        const currentBlock = await ethers.provider.getBlock("latest");
        const currentTimestamp = currentBlock.timestamp;
        const couponMaturity = [
            currentTimestamp + (86400*10),  
            currentTimestamp + (86400*20), 
            currentTimestamp + (86400*30),
            currentTimestamp + (86400*40),  
            currentTimestamp + (86400*50), 
            currentTimestamp + (86400*60),  

        ];
        const expiredBond = currentTimestamp + (86400*90);
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100') // ID 0
        await newBondFunction('500','20',couponMaturity,expiredBond,'10',issuer,'10000') // ID 1
        await newBondFunction('10000','75',couponMaturity,expiredBond,'100',issuer,'300') // ID 2
        await newBondFunction('350','2',couponMaturity,expiredBond,'2',issuer,'70') // ID 3
        await newBondFunction('800','80',couponMaturity,expiredBond,'8',issuer,'1000') // ID 4
        
        //? Approve launchBondContract at spending ERC1155
        await bondContract.connect(issuer).setApprovalForAll(launchBondContractAddress, true);

        //? Launch Bond ID1
        await expect(launchBondContract.connect(issuer).launchNewBond('1', '10000')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('0', '100')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('2', '300')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('4', '500')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('3', '70')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        
        //? Verifies
        const bondList = await launchBondContract.connect(issuer).showBondLaunchList()
        expect(bondList[3].toString()).eq("4");
        expect(await launchBondContract.connect(owner).showAmountInSellForBond('1')).eq('10000');

        const sizeBond = ethers.parseUnits((800*100).toString());

        await mockDai.connect(owner).transfer(user1, sizeBond);
        await mockDai.connect(user1).approve(launchBondContractAddress, sizeBond);

        const sizeBond2 = ethers.parseUnits((800*15).toString());

        await mockDai.connect(owner).transfer(user2, sizeBond2);
        await mockDai.connect(user2).approve(launchBondContractAddress, sizeBond);

        await expect(launchBondContract.connect(user1).buyBond(4, 3, 100)).to.emit(launchBondContract, 'BuyBond')
        expect((await launchBondContract.connect(user1).showBondForWithdraw(user1,4)).toString()).eq('100')
        await launchBondContract.connect(user1).withdrawBondBuy(4)

        expect(await launchBondContract.connect(user1).balanceIssuer(issuer.address,mockDai)).eq(sizeBond)

        await expect(launchBondContract.connect(user2).buyBond(4, 3, 15)).to.emit(launchBondContract, 'BuyBond')
        expect((await launchBondContract.connect(user2).showBondForWithdraw(user2,4)).toString()).eq('15')
        await launchBondContract.connect(user2).withdrawBondBuy(4)


        // verifiche
        const balanceBond1 = await bondContract.connect(user1).balanceOf(user1, 4);
        expect(balanceBond1.toString()).eq('100');
        const balanceBond2 = await bondContract.connect(user2).balanceOf(user2, 4);
        expect(balanceBond2.toString()).eq('15');
        expect(await launchBondContract.connect(owner).showAmountInSellForBond('4')).eq('385');
        expect(await mockDai.connect(owner).balanceOf(launchBondContract)).eq(ethers.parseUnits('92000'));
        // operazione post verifiche
        await expect(launchBondContract.connect(issuer).withdrawToken(await mockDai.getAddress())).to.emit(launchBondContract, 'WithdrawToken');
        const contractERC20balance = await mockDai.connect(owner).balanceOf(launchBondContractAddress)
        expect(contractERC20balance.toString()).eq('0');







    })
    it("Iusser pay for all coupon and repay all bond",async()=>{
        //? Approve spending
        await mockBTC.connect(issuer).approve(bondContractAddress,ethers.parseUnits('999999999'))
        await mockDai.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))
        await mockWETH.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))

        //? Create new Bond ( in this case all equal)
        const currentBlock = await ethers.provider.getBlock("latest");
        const currentTimestamp = currentBlock.timestamp;
        const couponMaturity = [
            currentTimestamp + (86400*10),  
            currentTimestamp + (86400*20), 
            currentTimestamp + (86400*30),
            currentTimestamp + (86400*40),  
            currentTimestamp + (86400*50), 
            currentTimestamp + (86400*60),  

        ];
        const expiredBond = currentTimestamp + (86400*90);
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100') // ID 0
        await newBondFunction('500','20',couponMaturity,expiredBond,'10',issuer,'10000') // ID 1
        await newBondFunction('10000','75',couponMaturity,expiredBond,'100',issuer,'300') // ID 2
        await newBondFunction('350','2',couponMaturity,expiredBond,'2',issuer,'70') // ID 3
        await newBondFunction('800','80',couponMaturity,expiredBond,'8',issuer,'500') // ID 4
        
        //? Approve launchBondContract at spending ERC1155
        await bondContract.connect(issuer).setApprovalForAll(launchBondContractAddress, true);

        //? Launch Bond ID1
        await expect(launchBondContract.connect(issuer).launchNewBond('1', '10000')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('0', '100')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('2', '300')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('4', '500')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('3', '70')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        
        //? Verifies
        const bondList = await launchBondContract.connect(issuer).showBondLaunchList()
        expect(bondList[3].toString()).eq("4");
        expect(await launchBondContract.connect(owner).showAmountInSellForBond('1')).eq('10000');

        const sizeBond = ethers.parseUnits((800*100).toString());

        await mockDai.connect(owner).transfer(user1, sizeBond);
        await mockDai.connect(user1).approve(launchBondContractAddress, sizeBond);

        const sizeBond2 = ethers.parseUnits((800*15).toString());

        await mockDai.connect(owner).transfer(user2, sizeBond2);
        await mockDai.connect(user2).approve(launchBondContractAddress, sizeBond);

        await expect(launchBondContract.connect(user1).buyBond(4, 3, 100)).to.emit(launchBondContract, 'BuyBond')
        expect((await launchBondContract.connect(user1).showBondForWithdraw(user1,4)).toString()).eq('100')
        await launchBondContract.connect(user1).withdrawBondBuy(4)

        await expect(launchBondContract.connect(user2).buyBond(4, 3, 15)).to.emit(launchBondContract, 'BuyBond')
        expect((await launchBondContract.connect(user2).showBondForWithdraw(user2,4)).toString()).eq('15')
        await launchBondContract.connect(user2).withdrawBondBuy(4)

        const sizeBond3 = ethers.parseUnits((800*385).toString());

        await mockDai.connect(owner).transfer(user3, sizeBond3);
        await mockDai.connect(user3).approve(launchBondContractAddress, sizeBond3);


        await expect(launchBondContract.connect(user3).buyBond(4, 3, 385)).to.emit(launchBondContract, 'BuyBond')
        expect((await launchBondContract.connect(user3).showBondForWithdraw(user3,4)).toString()).eq('385')
        await launchBondContract.connect(user3).withdrawBondBuy(4)

        /**
           await newBondFunction('800','80',couponMaturity,expiredBond,'8',issuer,'500') // ID 4
            ((80 mdai * 6 coupon) * 500) + (800*500) = 640.000
        */

        await mockDai.connect(owner).transfer(issuer, ethers.parseUnits('640000'));
        await mockDai.connect(issuer).approve(bondContractAddress, ethers.parseUnits('640000'));

        //? DEPOSIT TOKEN FOR PAY COUPON
        await expect(bondContract.connect(issuer).depositTokenForInterest(4,ethers.parseUnits('640000'))).to.emit(bondContract,'InterestDeposited')

        // in next time over expiredBond
        await ethers.provider.send("evm_increaseTime", [expiredBond+10000]);
        await ethers.provider.send("evm_mine");

        await expect(bondContract.connect(user1).claimCouponForUSer(4, 0)).to.emit(bondContract, "CouponClaimed");

        const daiBalance1 = await mockDai.connect(user1).balanceOf(user1)
        // 100 bond * 100 coupon da 80mdai - le fee dello 0.5% 
        expect(ethers.formatUnits(daiBalance1.toString())).to.eq((((100*80)*0.995)).toString()+'.0')

        await expect(bondContract.connect(user1).claimCouponForUSer(4, 1)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 2)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 3)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 4)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 5)).to.emit(bondContract, "CouponClaimed");

        for (let index = 0; index < couponMaturity.length; index++) {
            await expect(bondContract.connect(user2).claimCouponForUSer(4, index)).to.emit(bondContract, "CouponClaimed");
            await expect(bondContract.connect(user3).claimCouponForUSer(4, index)).to.emit(bondContract, "CouponClaimed");
        }
        
        const daiBalance3 = await mockDai.connect(user1).balanceOf(user1)
        await mockDai.connect(user1).transfer(owner,daiBalance3.toString());
        await expect(bondContract.connect(user1).claimLoan(4, 100)).to.emit(bondContract, "LoanClaimed");
        
        const daiBalance4 = await mockDai.connect(user1).balanceOf(user1)
        // 100 bond * 800 mdai - le fee dello 1.5% 
        expect(ethers.formatUnits(daiBalance4.toString())).to.eq((((100*800)*0.985)).toString()+'.0')
        
        await expect(bondContract.connect(user2).claimLoan(4, 15)).to.emit(bondContract, "LoanClaimed");
        await expect(bondContract.connect(user3).claimLoan(4, 385)).to.emit(bondContract, "LoanClaimed");
    
        await expect (bondContract.connect(owner).withdrawContractBalance(daiAddress)).to.emit(bondContract,'WitrawBalanceContracr')

        

    })
    it("Iusser pay for all coupon and repay all bond -> user send more bond at other user",async()=>{
        //? Approve spending
        await mockBTC.connect(issuer).approve(bondContractAddress,ethers.parseUnits('999999999'))
        await mockDai.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))
        await mockWETH.connect(owner).approve(bondContractAddress, ethers.parseUnits('999999999'))

        //? Create new Bond ( in this case all equal)
        const currentBlock = await ethers.provider.getBlock("latest");
        const currentTimestamp = currentBlock.timestamp;
        const couponMaturity = [
            currentTimestamp + (86400*10),  
            currentTimestamp + (86400*20), 
            currentTimestamp + (86400*30),
            currentTimestamp + (86400*40),  
            currentTimestamp + (86400*50), 
            currentTimestamp + (86400*60),  

        ];
        const expiredBond = currentTimestamp + (86400*90);
        await newBondFunction('1000','10',couponMaturity,expiredBond,'4',issuer,'100') // ID 0
        await newBondFunction('500','20',couponMaturity,expiredBond,'10',issuer,'10000') // ID 1
        await newBondFunction('10000','75',couponMaturity,expiredBond,'100',issuer,'300') // ID 2
        await newBondFunction('350','2',couponMaturity,expiredBond,'2',issuer,'70') // ID 3
        await newBondFunction('800','80',couponMaturity,expiredBond,'8',issuer,'500') // ID 4
        
        //? Approve launchBondContract at spending ERC1155
        await bondContract.connect(issuer).setApprovalForAll(launchBondContractAddress, true);

        //? Launch Bond ID1
        await expect(launchBondContract.connect(issuer).launchNewBond('1', '10000')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('0', '100')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('2', '300')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('4', '500')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        await expect(launchBondContract.connect(issuer).launchNewBond('3', '70')).to.emit(launchBondContract, 'IncrementBondInLaunch')
        


        const sizeBond = ethers.parseUnits((800*100).toString());

        await mockDai.connect(owner).transfer(user1, sizeBond);
        await mockDai.connect(user1).approve(launchBondContractAddress, sizeBond);

        const sizeBond2 = ethers.parseUnits((800*15).toString());

        await mockDai.connect(owner).transfer(user2, sizeBond2);
        await mockDai.connect(user2).approve(launchBondContractAddress, sizeBond);

        await expect(launchBondContract.connect(user1).buyBond(4, 3, 100)).to.emit(launchBondContract, 'BuyBond')
        await launchBondContract.connect(user1).withdrawBondBuy(4)

        await expect(launchBondContract.connect(user2).buyBond(4, 3, 15)).to.emit(launchBondContract, 'BuyBond')
        await launchBondContract.connect(user2).withdrawBondBuy(4)

        const sizeBond3 = ethers.parseUnits((800*385).toString());

        await mockDai.connect(owner).transfer(user3, sizeBond3);
        await mockDai.connect(user3).approve(launchBondContractAddress, sizeBond3);


        await expect(launchBondContract.connect(user3).buyBond(4, 3, 385)).to.emit(launchBondContract, 'BuyBond')
        await launchBondContract.connect(user3).withdrawBondBuy(4)

        /**
           await newBondFunction('800','80',couponMaturity,expiredBond,'8',issuer,'500') // ID 4
            ((80 mdai * 6 coupon) * 500) + (800*500) = 640.000
        */

        await mockDai.connect(owner).transfer(issuer, ethers.parseUnits('640000'));
        await mockDai.connect(issuer).approve(bondContractAddress, ethers.parseUnits('640000'));

        //? DEPOSIT TOKEN FOR PAY COUPON
        await expect(bondContract.connect(issuer).depositTokenForInterest(4,ethers.parseUnits('640000'))).to.emit(bondContract,'InterestDeposited')

        // in next time over expiredBond


        const dayInSecond = 86400;
        await ethers.provider.send("evm_increaseTime", [dayInSecond*5]);
        await ethers.provider.send("evm_mine");


        await mockWETH.connect(owner).transfer(user1, ethers.parseUnits('1000000'));
        await mockWETH.connect(user1).approve(bondContractAddress, ethers.parseUnits('1000000'));

        await mockWETH.connect(owner).transfer(user2, ethers.parseUnits('1000000'));
        await mockWETH.connect(user2).approve(bondContractAddress, ethers.parseUnits('1000000'));

        await mockWETH.connect(owner).transfer(user3, ethers.parseUnits('1000000'));
        await mockWETH.connect(user3).approve(bondContractAddress, ethers.parseUnits('1000000'));



        await expect(
            bondContract.connect(user3).safeTransferFrom(user3.address, user3.address, 4, 50, "0x")
        ).to.emit(bondContract, "SafeTransferFrom");

        const wethBalance = await mockWETH.connect(user3).balanceOf(user3);
        const transfertFee = await bondContract.connect(owner).showTransfertFee()

        expect(wethBalance.toString()).to.eq(
            ((+ethers.parseUnits('1000000').toString())-(+transfertFee.toString())).toString()
        )


        await ethers.provider.send("evm_increaseTime", [dayInSecond*7]);
        await ethers.provider.send("evm_mine");


        await expect(bondContract.connect(owner).claimCouponForUSer(4, 0)).to.emit(bondContract, "CouponClaimed");












        /*

        await expect(bondContract.connect(user1).claimCouponForUSer(4, 1)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 2)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 3)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 4)).to.emit(bondContract, "CouponClaimed");
        await expect(bondContract.connect(user1).claimCouponForUSer(4, 5)).to.emit(bondContract, "CouponClaimed");

        for (let index = 0; index < couponMaturity.length; index++) {
            await expect(bondContract.connect(user2).claimCouponForUSer(4, index)).to.emit(bondContract, "CouponClaimed");
            await expect(bondContract.connect(user3).claimCouponForUSer(4, index)).to.emit(bondContract, "CouponClaimed");
        }
        
        await expect(bondContract.connect(user1).claimLoan(4, 100)).to.emit(bondContract, "LoanClaimed");
        
        // 100 bond * 800 mdai - le fee dello 1.5% 
        
        await expect(bondContract.connect(user2).claimLoan(4, 15)).to.emit(bondContract, "LoanClaimed");
        await expect(bondContract.connect(user3).claimLoan(4, 385)).to.emit(bondContract, "LoanClaimed");
    */

        

    })



});
